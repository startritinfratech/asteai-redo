import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import {
  DISPUTABLE_MILESTONE_STATUSES, DISPUTE_RESPONSE_HOURS, isEvidenceLink, OPEN_DISPUTE_STATUSES, toMinor,
  type Dispute, type DisputeReasonCode, type DisputeResolution, type DisputeStatus, type DisputeSummary,
  type ResolveDisputeResult, type User,
} from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { Pagination } from '../../common/utils/pagination';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import { ContractsService } from '../contracts/contracts.service';
import { EmailService } from '../email/email.service';
import type { TemplateData } from '../email/templates';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DisputeMessageRow, DisputeRow, mapDispute, mapDisputeMessage, mapDisputeSummary,
} from './dispute.mapper';
import { CreateDisputeDto, DisputeMessageDto, ResolveDisputeDto } from './dto/dispute.dto';

const OPEN = OPEN_DISPUTE_STATUSES as readonly string[];
const HELD = DISPUTABLE_MILESTONE_STATUSES as readonly string[];

const WITH_NAMES = `SELECT d.*, COALESCE(pj.title, c.title) AS project_title, m.title AS milestone_title, c.currency,
       c.buyer_id, c.expert_id,
       CONCAT_WS(' ', rb.first_name, rb.last_name) AS raised_by_name,
       CONCAT_WS(' ', au.first_name, au.last_name) AS against_user_name
  FROM disputes d
  LEFT JOIN contracts c ON c.id = d.contract_id
  LEFT JOIN projects pj ON pj.id = COALESCE(d.project_id, c.project_id)
  LEFT JOIN contract_milestones m ON m.id = d.milestone_id
  LEFT JOIN user_accounts rb ON rb.id = d.raised_by
  LEFT JOIN user_accounts au ON au.id = d.against_user`;

export const REASON_LABEL: Record<DisputeReasonCode, string> = {
  quality: 'Quality of the work',
  scope: 'Scope disagreement',
  non_delivery: 'Work not delivered',
  late: 'Late delivery',
  payment: 'Payment issue',
  communication: 'Communication breakdown',
  other: 'Other',
};

const link = (id: string) => `/platform/disputes/${encodeURIComponent(id)}`;
const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString('en-IN')}`;
const fullName = (u: User) => [u.firstName, u.lastName].filter(Boolean).join(' ');

interface Notice { userId: string; text: string; link: string }

/**
 * Disputes on contracts, optionally about one milestone.
 *
 * Raising a dispute freezes the contract ('disputed') in the same transaction, so nothing
 * can be funded, moved, released or cancelled by the buyer until it is resolved or
 * withdrawn; the contract returns to 'active' (or 'completed') when its last open dispute
 * closes. An admin resolution moves the escrow held on the disputed milestone(s) through
 * ContractsService (release ledger, refund_due) and then starts the Razorpay refund for the
 * buyer's share after COMMIT.
 *
 * Lock order: contract → dispute → milestone (the contracts module's contract → milestone).
 * Posting a message locks only the dispute row. Notifications go out after COMMIT; emails
 * are queued inside the transaction (sent only if it commits).
 */
@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly contracts: ContractsService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  // ─── Reads ────────────────────────────────────────────────────────────────

  /** The caller's disputes (either side); admins see all. Admin queue: open first, oldest deadline first. */
  async findAll(user: User, status: DisputeStatus | undefined, { pageSize, offset }: Pagination): Promise<DisputeSummary[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const isAdmin = user.role === 'Admin';
    if (!isAdmin) {
      params.push(user.id);
      const p = `$${params.length}`;
      where.push(`(d.raised_by = ${p} OR d.against_user = ${p} OR c.buyer_id = ${p} OR c.expert_id = ${p})`);
    }
    if (status) {
      params.push(status);
      where.push(`d.status = $${params.length}`);
    }
    params.push(pageSize, offset);
    const order = isAdmin
      ? `CASE WHEN d.status IN ('open', 'awaiting_response', 'under_review') THEN 0 ELSE 1 END, d.respond_by ASC, d.created_at DESC`
      : 'd.created_at DESC';
    const { rows } = await this.db.query<DisputeRow>(
      `${WITH_NAMES} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map(mapDisputeSummary);
  }

  /** The two parties and admins. Internal notes are returned to admins only. */
  async findOne(id: string, user: User): Promise<Dispute> {
    const { rows } = await this.db.query<DisputeRow>(`${WITH_NAMES} WHERE d.id = $1`, [id]);
    const dispute = rows[0];
    if (!dispute) throw new NotFoundException(`Dispute ${id} not found`);
    const isAdmin = user.role === 'Admin';
    if (!isAdmin && !this.isParty(dispute, user.id)) throw new ForbiddenException();

    const { rows: messages } = await this.db.query<DisputeMessageRow>(
      `SELECT dm.*, CONCAT_WS(' ', u.first_name, u.last_name) AS author_name, u.role::text AS author_role
         FROM dispute_messages dm
         JOIN user_accounts u ON u.id = dm.author_id
        WHERE dm.dispute_id = $1 ${isAdmin ? '' : 'AND dm.is_internal = FALSE'}
        ORDER BY dm.created_at, dm.id`,
      [id],
    );
    const held = await this.heldAmount(this.db, dispute);
    const parties = { buyerId: dispute.buyer_id ?? null, expertId: dispute.expert_id ?? null };
    return mapDispute(dispute, messages.map((m) => mapDisputeMessage(m, parties)), held);
  }

  // ─── Raise ────────────────────────────────────────────────────────────────

  /**
   * The contract's buyer or expert, on a running contract ('active', or already 'disputed'
   * over another milestone). With a milestone, it must hold escrow (funded / submitted /
   * revision_requested / accepted) and have no open dispute, and the contract no open
   * contract-wide dispute; without one, the contract must have no open dispute at all.
   * amountInDispute is capped by the escrow held on the milestone (or the contract).
   */
  async create(dto: CreateDisputeDto, user: User): Promise<Dispute> {
    const description = dto.description.trim();
    if (description.length < 10) throw new BadRequestException('Describe the problem in at least 10 characters');

    const { id, notices } = await withTransaction(this.db, async (client) => {
      const contract = await this.contracts.lockForDispute(client, dto.contractId);
      const isBuyer = contract.buyer_id === user.id;
      const isExpert = contract.expert_id === user.id;
      if (!isBuyer && !isExpert) throw new ForbiddenException('Only the buyer or the expert of a contract can raise a dispute');
      if (contract.status !== 'active' && contract.status !== 'disputed') {
        throw new ConflictException(`A dispute can only be raised on an active contract (this one is '${contract.status}')`);
      }

      const { rows: open } = await client.query<{ id: string; milestone_id: string | null }>(
        `SELECT id, milestone_id FROM disputes WHERE contract_id = $1 AND status = ANY($2::text[])`,
        [contract.id, OPEN],
      );
      if (dto.milestoneId) {
        if (open.some((d) => d.milestone_id === null)) {
          throw new ConflictException('A dispute about the whole contract is already open');
        }
        if (open.some((d) => d.milestone_id === dto.milestoneId)) {
          throw new ConflictException('A dispute about this milestone is already open');
        }
      } else if (open.length) {
        throw new ConflictException('A dispute on this contract is already open; add to it instead');
      }

      let held: number;
      let milestoneTitle: string | null = null;
      if (dto.milestoneId) {
        const milestone = await this.contracts.lockMilestoneForDispute(client, contract.id, dto.milestoneId);
        if (!HELD.includes(milestone.status)) {
          throw new ConflictException(
            `A dispute needs money at stake; milestone "${milestone.title}" is '${milestone.status}'`);
        }
        held = toMinor(Number(milestone.amount));
        milestoneTitle = milestone.title;
      } else {
        held = await this.heldMinor(client, contract.id, null);
      }
      if (dto.amountInDispute !== undefined && toMinor(dto.amountInDispute) > held) {
        throw new BadRequestException(`At most ${money(held / 100, contract.currency)} is held in escrow here`);
      }

      await this.contracts.freezeForDispute(client, contract);
      const id = generateId('DSP');
      const againstUser = isBuyer ? contract.expert_id : contract.buyer_id;
      try {
        await client.query(
          `INSERT INTO disputes (id, contract_id, milestone_id, project_id, raised_by, against_user, reason_code,
                                 description, amount_in_dispute, status, respond_by, previous_contract_status, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open', NOW() + make_interval(hours => $10), $11, 'app')`,
          [
            id, contract.id, dto.milestoneId ?? null, contract.project_id, user.id, againstUser, dto.reasonCode,
            description, dto.amountInDispute ?? null, DISPUTE_RESPONSE_HOURS, contract.status,
          ],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException('A dispute about this milestone is already open');
        throw err;
      }

      const respondBy = new Date(Date.now() + DISPUTE_RESPONSE_HOURS * 3_600_000)
        .toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
      const reason = REASON_LABEL[dto.reasonCode];
      await this.emailUser(client, againstUser, 'dispute-opened', (firstName) => ({
        firstName, raisedByName: fullName(user), contractId: contract.id, milestoneTitle, reason,
        respondBy: `${respondBy} IST`, path: link(id),
      }), `dispute-opened:${id}`);

      const about = milestoneTitle ? `milestone "${milestoneTitle}"` : `contract ${contract.id}`;
      const notices: Notice[] = [
        { userId: againstUser, text: `${fullName(user) || 'The other party'} raised a dispute on ${about}; please respond within ${DISPUTE_RESPONSE_HOURS} hours`, link: link(id) },
        ...(await this.adminIds(client)).map((userId) => ({
          userId, text: `New dispute ${id} on ${about} (${reason})`, link: link(id),
        })),
      ];
      return { id, notices };
    });
    await this.notify(notices);
    return this.findOne(id, user);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  /**
   * Parties and admins post while the dispute is open; only admins may post internal notes.
   * Status moves: the respondent's first reply takes 'open' → 'under_review'; an admin's
   * (non-internal) message on 'under_review' asks the parties for input ('awaiting_response'),
   * and the next party message takes it back to 'under_review'.
   */
  async addMessage(id: string, dto: DisputeMessageDto, user: User): Promise<Dispute> {
    const isAdmin = user.role === 'Admin';
    const internal = dto.internal === true;
    if (internal && !isAdmin) throw new ForbiddenException('Only admins can post internal notes');
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('The message is empty');
    const links = (dto.evidenceLinks ?? []).map((l) => l.trim()).filter(Boolean);
    if (links.length > 10) throw new BadRequestException('At most 10 evidence links');
    const bad = links.find((l) => !isEvidenceLink(l));
    if (bad) throw new BadRequestException(`Evidence links must be https URLs: ${bad.slice(0, 100)}`);

    const notices = await withTransaction(this.db, async (client) => {
      const dispute = await this.lockDispute(client, id);
      const isParty = this.isParty(dispute, user.id);
      if (!isAdmin && !isParty) throw new ForbiddenException();
      if (!OPEN.includes(dispute.status)) throw new ConflictException(`The dispute is '${dispute.status}'`);

      await client.query(
        `INSERT INTO dispute_messages (dispute_id, author_id, body, evidence_links, is_internal)
         VALUES ($1, $2, $3, $4::text[], $5)`,
        [id, user.id, body, links, internal],
      );

      let next: DisputeStatus = dispute.status;
      if (!isAdmin && dispute.status === 'open' && user.id === dispute.against_user) next = 'under_review';
      else if (!isAdmin && dispute.status === 'awaiting_response') next = 'under_review';
      else if (isAdmin && !internal && dispute.status === 'under_review') next = 'awaiting_response';
      if (next !== dispute.status) {
        await client.query(
          `UPDATE disputes SET status = $2, updated_at = NOW() WHERE id = $1 AND status = $3`,
          [id, next, dispute.status],
        );
      } else {
        await client.query(`UPDATE disputes SET updated_at = NOW() WHERE id = $1`, [id]);
      }

      if (internal) return [];
      const text = isAdmin ? `The AsteAI team posted on dispute ${id}` : `New message on dispute ${id}`;
      const recipients = isAdmin
        ? [dispute.raised_by, dispute.against_user]
        : [dispute.raised_by, dispute.against_user].filter((u) => u !== user.id);
      const out: Notice[] = recipients.map((userId) => ({ userId, text, link: link(id) }));
      if (!isAdmin && next === 'under_review' && dispute.status !== 'under_review') {
        out.push(...(await this.adminIds(client)).map((userId) => ({
          userId, text: `Dispute ${id} has replies from both sides and is ready for review`, link: link(id),
        })));
      }
      return out;
    });
    await this.notify(notices);
    return this.findOne(id, user);
  }

  // ─── Withdraw ─────────────────────────────────────────────────────────────

  /** The party who raised it, while it is open. The contract unfreezes if no other dispute is open. */
  async withdraw(id: string, user: User): Promise<Dispute> {
    const notices = await withTransaction(this.db, async (client) => {
      const contractId = await this.contractIdOf(client, id);
      if (contractId) await this.contracts.lockForDispute(client, contractId);
      const dispute = await this.lockDispute(client, id);
      if (dispute.raised_by !== user.id) throw new ForbiddenException('Only the party who raised a dispute can withdraw it');
      if (!OPEN.includes(dispute.status)) throw new ConflictException(`A '${dispute.status}' dispute cannot be withdrawn`);
      await client.query(
        `UPDATE disputes SET status = 'withdrawn', updated_at = NOW() WHERE id = $1 AND status = $2`,
        [id, dispute.status],
      );
      if (contractId) await this.unfreezeIfLast(client, contractId, id);
      return [
        { userId: dispute.against_user, text: `Dispute ${id} was withdrawn`, link: link(id) },
        ...(await this.adminIds(client)).map((userId) => ({ userId, text: `Dispute ${id} was withdrawn by the party who raised it`, link: link(id) })),
      ];
    });
    await this.notify(notices);
    return this.findOne(id, user);
  }

  // ─── Resolve ──────────────────────────────────────────────────────────────

  /**
   * Admin. In one transaction holding the contract lock:
   *   release_to_expert  the disputed milestone(s) → released, 'Escrow release' ledger row(s);
   *   refund_to_buyer    the disputed milestone(s) → cancelled, refund_due += the held amount;
   *   split              splitExpertAmount released to the expert, splitBuyerAmount added to
   *                      refund_due; the two must add up to the escrow held;
   *   no_action          nothing moves.
   * A contract-wide dispute covers every milestone holding escrow (a split pays the expert
   * milestone by milestone in order). Then the contract returns to 'active' (or 'completed')
   * unless another dispute is open, an audit_log row is written and both parties are emailed.
   * After COMMIT the buyer's share is refunded through Razorpay (ContractsService.issueRefund);
   * if that fails, refund_due stays and an admin can retry from the contract page.
   */
  async resolve(id: string, dto: ResolveDisputeDto, admin: User): Promise<ResolveDisputeResult> {
    if (admin.role !== 'Admin') throw new ForbiddenException();
    const note = dto.note.trim();
    if (note.length < 3) throw new BadRequestException('Add a resolution note');
    const isSplit = dto.resolution === 'split';
    const hasAmounts = dto.splitExpertAmount !== undefined || dto.splitBuyerAmount !== undefined;
    if (isSplit && (dto.splitExpertAmount === undefined || dto.splitBuyerAmount === undefined)) {
      throw new BadRequestException('A split needs both splitExpertAmount and splitBuyerAmount');
    }
    if (!isSplit && hasAmounts) throw new BadRequestException('Split amounts are only used with a split resolution');

    const outcome = await withTransaction(this.db, async (client) => {
      const contractId = await this.contractIdOf(client, id);
      const contract = contractId ? await this.contracts.lockForDispute(client, contractId) : null;
      const dispute = await this.lockDispute(client, id);
      if (!OPEN.includes(dispute.status)) throw new ConflictException(`A '${dispute.status}' dispute cannot be resolved`);
      const currency = contract?.currency ?? 'INR';

      let toExpert = 0;
      let toBuyer = 0;
      const milestoneIds: string[] = [];
      if (dto.resolution !== 'no_action') {
        if (!contract) throw new ConflictException('This dispute has no contract; resolve it with no_action');
        if (contract.status !== 'disputed') {
          throw new ConflictException(`The contract is '${contract.status}'; only no_action is possible`);
        }
        const targets = await this.heldMilestones(client, contract.id, dispute.milestone_id);
        const heldMinor = targets.reduce((acc, m) => acc + m.minor, 0);
        if (heldMinor <= 0) throw new ConflictException('No escrow is held on the disputed milestone(s); resolve with no_action');

        let expertLeft = dto.resolution === 'release_to_expert' ? heldMinor : 0;
        if (isSplit) {
          const e = toMinor(dto.splitExpertAmount!);
          const b = toMinor(dto.splitBuyerAmount!);
          if (e + b !== heldMinor) {
            throw new BadRequestException(
              `The split must add up to the ${money(heldMinor / 100, currency)} held (got ${money((e + b) / 100, currency)})`);
          }
          expertLeft = e;
        }
        for (const m of targets) {
          const e = Math.min(m.minor, expertLeft);
          expertLeft -= e;
          const settled = await this.contracts.settleMilestoneByAdmin(
            client, contract.id, m.id, { toExpert: e / 100, toBuyer: (m.minor - e) / 100 }, admin, id);
          toExpert += toMinor(settled.toExpert);
          toBuyer += toMinor(settled.toBuyer);
          milestoneIds.push(m.id);
        }
      }

      await client.query(
        `UPDATE disputes
            SET status = 'resolved', resolution = $2, split_expert_amount = $3, split_buyer_amount = $4,
                resolution_note = $5, resolved_by = $6, resolved_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = $7`,
        [
          id, dto.resolution, isSplit ? toExpert / 100 : null, isSplit ? toBuyer / 100 : null, note, admin.id,
          dispute.status,
        ],
      );
      const contractStatus = contract ? await this.unfreezeIfLast(client, contract.id, id) : null;

      await client.query(
        `INSERT INTO audit_log (actor_id, actor_name, role, action, entity, meta)
         VALUES ($1, $2, $3, 'Dispute resolved', $4, $5)`,
        [
          admin.id, fullName(admin), admin.role, `dispute:${id}`,
          JSON.stringify({
            resolution: dto.resolution, contractId: contract?.id ?? null, milestoneIds,
            toExpert: toExpert / 100, toBuyer: toBuyer / 100, currency, contractStatus, note,
          }),
        ],
      );

      const sentence = describeOutcome(dto.resolution, toExpert / 100, toBuyer / 100, currency);
      for (const userId of [dispute.raised_by, dispute.against_user]) {
        await this.emailUser(client, userId, 'dispute-resolved', (firstName) => ({
          firstName, disputeId: id, contractId: contract?.id ?? dispute.project_id ?? '—', outcome: sentence, note, path: link(id),
        }), `dispute-resolved:${id}:${userId}`);
      }
      const notices: Notice[] = [dispute.raised_by, dispute.against_user].map((userId) => ({
        userId, text: `Dispute ${id} was resolved. ${sentence}`, link: link(id),
      }));
      return { contractId: contract?.id ?? null, toBuyer: toBuyer / 100, currency, notices };
    });

    // After COMMIT: pay the buyer's share back through Razorpay. Never undoes the resolution.
    let refund: ResolveDisputeResult['refund'] = { amount: outcome.toBuyer, status: 'none' };
    if (outcome.contractId && toMinor(outcome.toBuyer) > 0) {
      try {
        const result = await this.contracts.issueRefund(
          outcome.contractId, { reason: `Dispute ${id}: ${note}`.slice(0, 2000), amount: outcome.toBuyer }, admin);
        const failed = result.refunds.filter((r) => r.status === 'failed');
        refund = failed.length && failed.length === result.refunds.length
          ? { amount: outcome.toBuyer, status: 'failed', error: failed[0].error ?? 'Razorpay refused the refund' }
          : { amount: outcome.toBuyer, status: 'requested' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Refund after dispute ${id} on ${outcome.contractId} not started: ${message}`);
        refund = { amount: outcome.toBuyer, status: 'failed', error: message };
      }
    }
    await this.notify(outcome.notices);
    return { dispute: await this.findOne(id, admin), refund };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private isParty(d: DisputeRow, userId: string): boolean {
    return [d.raised_by, d.against_user, d.buyer_id, d.expert_id].includes(userId);
  }

  /** The dispute's contract id, read without a lock (to take the contract lock first). */
  private async contractIdOf(client: PoolClient, id: string): Promise<string | null> {
    const { rows } = await client.query<{ contract_id: string | null }>(`SELECT contract_id FROM disputes WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException(`Dispute ${id} not found`);
    return rows[0].contract_id;
  }

  /** The dispute row, locked, with its contract's parties. */
  private async lockDispute(client: PoolClient, id: string): Promise<DisputeRow> {
    const { rows } = await client.query<DisputeRow>(
      `SELECT d.*, c.buyer_id, c.expert_id, c.currency
         FROM disputes d LEFT JOIN contracts c ON c.id = d.contract_id
        WHERE d.id = $1
        FOR UPDATE OF d`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`Dispute ${id} not found`);
    return rows[0];
  }

  /** The milestones a resolution acts on (the disputed one, or every one holding escrow), in order. */
  private async heldMilestones(client: PoolClient, contractId: string, milestoneId: string | null) {
    const { rows } = await client.query<{ id: string; amount: string; status: string }>(
      `SELECT id, amount, status FROM contract_milestones
        WHERE contract_id = $1 AND status = ANY($2::text[]) AND ($3::uuid IS NULL OR id = $3::uuid)
        ORDER BY seq`,
      [contractId, HELD, milestoneId],
    );
    return rows.map((r) => ({ id: r.id, minor: toMinor(Number(r.amount)) }));
  }

  private async heldMinor(client: Pick<PoolClient, 'query'>, contractId: string, milestoneId: string | null): Promise<number> {
    const { rows } = await client.query<{ held: string | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS held FROM contract_milestones
        WHERE contract_id = $1 AND status = ANY($2::text[]) AND ($3::uuid IS NULL OR id = $3::uuid)`,
      [contractId, HELD, milestoneId],
    );
    return toMinor(Number(rows[0]?.held ?? 0));
  }

  private async heldAmount(client: Pick<PoolClient, 'query'>, d: DisputeRow): Promise<number> {
    if (!d.contract_id || !OPEN.includes(d.status)) return 0;
    return (await this.heldMinor(client, d.contract_id, d.milestone_id)) / 100;
  }

  /** Restores the contract when `closingId` was its last open dispute. Returns the contract status. */
  private async unfreezeIfLast(client: PoolClient, contractId: string, closingId: string): Promise<string | null> {
    const { rows } = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM disputes WHERE contract_id = $1 AND id <> $2 AND status = ANY($3::text[])`,
      [contractId, closingId, OPEN],
    );
    if (Number(rows[0]?.n ?? 0) > 0) return 'disputed';
    return this.contracts.restoreAfterDispute(client, contractId);
  }

  private async adminIds(client: Pick<PoolClient, 'query'>): Promise<string[]> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM user_accounts WHERE role = 'Admin' AND account_status = 'active'`,
    );
    return rows.map((r) => r.id);
  }

  /** Queues a templated email to `userId` inside the caller's transaction. */
  private async emailUser<K extends 'dispute-opened' | 'dispute-resolved'>(
    client: PoolClient, userId: string, template: K, data: (firstName: string) => TemplateData[K], dedupeKey: string,
  ) {
    const { rows } = await client.query<{ email: string | null; first_name: string | null }>(
      `SELECT email, first_name FROM user_accounts WHERE id = $1`,
      [userId],
    );
    if (!rows[0]?.email) return;
    await this.email.enqueue(template, rows[0].email, data(rows[0].first_name ?? ''), { userId, dedupeKey, client });
  }

  private async notify(notices: Notice[]) {
    for (const n of notices) {
      try {
        await this.notifications.send(n.userId, n.text, n.link);
      } catch (err) {
        this.logger.warn(`Notification to ${n.userId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

/** One sentence on what the resolution did with the money. */
export function describeOutcome(resolution: DisputeResolution, toExpert: number, toBuyer: number, currency: string): string {
  switch (resolution) {
    case 'release_to_expert': return `${money(toExpert, currency)} held in escrow was released to the expert.`;
    case 'refund_to_buyer': return `${money(toBuyer, currency)} held in escrow will be refunded to the buyer.`;
    case 'split': return `${money(toExpert, currency)} was released to the expert and ${money(toBuyer, currency)} will be refunded to the buyer.`;
    default: return 'No money was moved.';
  }
}
