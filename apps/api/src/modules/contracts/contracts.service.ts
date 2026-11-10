import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { Pagination } from '../../common/utils/pagination';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import { NotificationsService } from '../notifications/notifications.service';
import {
  paymentTermsError, paymentTermsTotal, toMinor,
  type CapturePaymentResult, type Contract, type ContractStatus, type ContractSummary, type FundMilestoneResult,
  type PaymentTerms,
} from './contract.types';
import {
  BUYER_CANCELLABLE, CANCELLABLE, canApply, isActor, MILESTONE_ACTIONS, MilestoneAction, normaliseName, partyOf,
} from './contract-rules';
import {
  ContractRow, mapContractRow, mapContractSummary, MilestoneRow, PaymentRow,
} from './contract.mapper';
import { CreateContractDto } from './dto/contract.dto';

const WITH_NAMES = `SELECT c.*, pj.title AS project_title,
       CONCAT_WS(' ', b.first_name, b.last_name) AS buyer_name,
       CONCAT_WS(' ', e.first_name, e.last_name) AS expert_name
  FROM contracts c
  JOIN projects pj ON pj.id = c.project_id
  JOIN user_accounts b ON b.id = c.buyer_id
  JOIN user_accounts e ON e.id = c.expert_id`;

const link = (id: string) => `/platform/contracts/${id}`;
const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString('en-IN')}`;

interface Notice { userId: string; text: string; link: string }

/**
 * Contracts between a buyer and the expert whose proposal they awarded.
 *
 * Every state or money change runs in one transaction that locks the contract row first
 * (SELECT … FOR UPDATE) and then makes conditional updates (`WHERE status = <expected>`),
 * so concurrent requests can't double-apply. Lock order is always contract → payment →
 * milestone. Notifications go out after COMMIT and never undo a committed change.
 */
@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Reads ────────────────────────────────────────────────────────────────

  /** The caller's contracts (admins: all), newest first. */
  async findAll(user: User, status: ContractStatus | undefined, { pageSize, offset }: Pagination): Promise<ContractSummary[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (user.role !== 'Admin') {
      params.push(user.id);
      where.push(`(c.buyer_id = $${params.length} OR c.expert_id = $${params.length})`);
    }
    if (status) {
      params.push(status);
      where.push(`c.status = $${params.length}`);
    }
    params.push(pageSize, offset);
    const { rows } = await this.db.query<ContractRow>(
      `${WITH_NAMES} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map(mapContractSummary);
  }

  /** Participants and admins only. */
  async findOne(id: string, user: User): Promise<Contract> {
    const { rows } = await this.db.query<ContractRow>(`${WITH_NAMES} WHERE c.id = $1`, [id]);
    const contract = rows[0];
    if (!contract) throw new NotFoundException(`Contract ${id} not found`);
    const party = partyOf(contract, user);
    if (!party.isAdmin && !party.isBuyer && !party.isExpert) throw new ForbiddenException();
    const { rows: milestones } = await this.db.query<MilestoneRow>(
      `SELECT m.*, EXISTS (
                SELECT 1 FROM escrow_payments ep WHERE ep.milestone_id = m.id AND ep.status = 'pending'
              ) AS payment_pending
         FROM contract_milestones m WHERE m.contract_id = $1 ORDER BY m.seq`,
      [id],
    );
    return mapContractRow(contract, milestones);
  }

  // ─── Create & sign ────────────────────────────────────────────────────────

  /**
   * The buyer of the proposal's project, once that proposal is awarded. The payment terms
   * fix the contract value, and the milestones must add up to exactly that value.
   */
  async create(dto: CreateContractDto, user: User): Promise<Contract> {
    const termsError = paymentTermsError(dto.engagementModel, dto.paymentTerms);
    if (termsError) throw new BadRequestException(termsError);
    const terms = dto.paymentTerms as unknown as PaymentTerms;
    const total = paymentTermsTotal(dto.engagementModel, terms);
    if (!(total > 0) || total >= 1e10) throw new BadRequestException('The contract value is out of range');
    const sum = dto.milestones.reduce((acc, m) => acc + toMinor(m.amount), 0);
    if (sum !== toMinor(total)) {
      throw new BadRequestException(`Milestones add up to ${sum / 100} but the payment terms total ${total}`);
    }
    const ndaText = dto.ndaText?.trim() || null;
    if (dto.ndaRequired && !ndaText) throw new BadRequestException('An NDA is required, so its text is required');

    const id = generateId('CT');
    const expertId = await withTransaction(this.db, async (client) => {
      const { rows } = await client.query<{
        id: string; expert_id: string; status: string; project_id: string;
        buyer_id: string; awarded_to: string | null; tenant_id: string | null;
      }>(
        `SELECT p.id, p.expert_id, p.status, p.project_id, pr.buyer_id, pr.awarded_to, pr.tenant_id
           FROM proposals p JOIN projects pr ON pr.id = p.project_id
          WHERE p.id = $1
          FOR UPDATE OF p, pr`,
        [dto.proposalId],
      );
      const proposal = rows[0];
      if (!proposal) throw new NotFoundException('Proposal not found');
      if (proposal.buyer_id !== user.id) throw new ForbiddenException();
      if (proposal.status !== 'Awarded' || proposal.awarded_to !== proposal.expert_id) {
        throw new ConflictException('A contract can only be created for the awarded proposal');
      }
      const { rows: existing } = await client.query(`SELECT id FROM contracts WHERE proposal_id = $1`, [proposal.id]);
      if (existing.length) throw new ConflictException('This proposal already has a contract');

      try {
        await client.query(
          `INSERT INTO contracts (id, project_id, proposal_id, tenant_id, buyer_id, expert_id, engagement_model,
                                  payment_terms, currency, total_amount, status, nda_required, nda_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'pending_signature',$11,$12)`,
          [
            id, proposal.project_id, proposal.id, proposal.tenant_id, user.id, proposal.expert_id,
            dto.engagementModel, JSON.stringify(terms), dto.currency ?? 'INR', total, dto.ndaRequired,
            dto.ndaRequired ? ndaText : null,
          ],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException('This proposal already has a contract');
        throw err;
      }
      await client.query(
        `INSERT INTO contract_milestones (contract_id, seq, title, amount, due_date)
         SELECT $1, u.seq, u.title, u.amount, u.due_date
           FROM unnest($2::smallint[], $3::text[], $4::numeric[], $5::date[]) AS u(seq, title, amount, due_date)`,
        [
          id,
          dto.milestones.map((_, i) => i + 1),
          dto.milestones.map((m) => m.title.trim()),
          dto.milestones.map((m) => m.amount),
          dto.milestones.map((m) => m.dueDate ?? null),
        ],
      );
      return proposal.expert_id;
    });

    await this.notify([{ userId: expertId, text: `${user.firstName ?? 'The buyer'} sent you a contract to review and sign`, link: link(id) }]);
    return this.findOne(id, user);
  }

  /**
   * Each party signs once by typing their account name. Stores the time, the typed name
   * and the request IP; the second signature activates the contract.
   */
  async sign(id: string, signatureName: string, ip: string | undefined, user: User): Promise<Contract> {
    const { contract, notices } = await withTransaction(this.db, async (client) => {
      const contract = await this.lockContract(client, id);
      const party = partyOf(contract, user);
      if (!party.isBuyer && !party.isExpert) throw new ForbiddenException('Only the two parties sign a contract');
      if (contract.status !== 'pending_signature') {
        throw new ConflictException(`A contract that is '${contract.status}' cannot be signed`);
      }
      const side = party.isBuyer ? 'buyer' : 'expert';
      if (party.isBuyer ? contract.buyer_signed_at : contract.expert_signed_at) throw new ConflictException('You have already signed this contract');

      const { rows: accounts } = await client.query<{ first_name: string | null; last_name: string | null }>(
        `SELECT first_name, last_name FROM user_accounts WHERE id = $1`,
        [user.id],
      );
      const accountName = [accounts[0]?.first_name, accounts[0]?.last_name].filter(Boolean).join(' ');
      if (!accountName || normaliseName(signatureName) !== normaliseName(accountName)) {
        throw new BadRequestException('Type your full name exactly as it appears on your account');
      }

      const other = side === 'buyer' ? 'expert' : 'buyer';
      const { rows } = await client.query<ContractRow>(
        `UPDATE contracts
            SET ${side}_signed_at = NOW(), ${side}_signature = $2, ${side}_signature_ip = $3,
                status = CASE WHEN ${other}_signed_at IS NOT NULL THEN 'active' ELSE status END,
                updated_at = NOW()
          WHERE id = $1 AND status = 'pending_signature' AND ${side}_signed_at IS NULL
          RETURNING *`,
        [id, signatureName.trim(), ip ? ip.slice(0, 64) : null],
      );
      if (!rows.length) throw new ConflictException('The contract changed meanwhile; reload and try again');
      const updated = rows[0];
      const otherId = side === 'buyer' ? contract.expert_id : contract.buyer_id;
      const notices: Notice[] = updated.status === 'active'
        ? [contract.buyer_id, contract.expert_id].map((userId) => ({
          userId, text: `Contract ${id} is signed by both parties and now active`, link: link(id),
        }))
        : [{ userId: otherId, text: `Contract ${id} was signed by the ${side}; it's waiting for your signature`, link: link(id) }];
      return { contract: updated, notices };
    });
    await this.notify(notices);
    return this.findOne(contract.id, user);
  }

  /** The expert turns the contract down before signing it. */
  async decline(id: string, reason: string | undefined, user: User): Promise<Contract> {
    const contract = await withTransaction(this.db, async (client) => {
      const contract = await this.lockContract(client, id);
      if (!partyOf(contract, user).isExpert) throw new ForbiddenException('Only the expert can decline a contract');
      if (contract.status !== 'pending_signature' || contract.expert_signed_at) {
        throw new ConflictException('Only a contract you have not signed yet can be declined');
      }
      const { rows } = await client.query<ContractRow>(
        `UPDATE contracts
            SET status = 'cancelled', cancelled_by = $2, cancel_reason = $3, updated_at = NOW()
          WHERE id = $1 AND status = 'pending_signature' AND expert_signed_at IS NULL
          RETURNING *`,
        [id, user.id, reason?.trim() || 'Declined by the expert'],
      );
      if (!rows.length) throw new ConflictException('The contract changed meanwhile; reload and try again');
      await client.query(
        `UPDATE contract_milestones SET status = 'cancelled', updated_at = NOW()
          WHERE contract_id = $1 AND status = 'pending'`,
        [id],
      );
      return rows[0];
    });
    await this.notify([{ userId: contract.buyer_id, text: `The expert declined contract ${id}`, link: link(id) }]);
    return this.findOne(id, user);
  }

  // ─── Money ────────────────────────────────────────────────────────────────

  /**
   * The buyer asks to fund a pending milestone. This only opens an escrow_payments request
   * (status 'pending'); the milestone stays 'pending' until the payment is captured. A
   * second request while one is open returns the open one.
   */
  async fundMilestone(id: string, milestoneId: string, user: User): Promise<FundMilestoneResult> {
    return withTransaction(this.db, async (client) => {
      const contract = await this.lockContract(client, id);
      if (!partyOf(contract, user).isBuyer) throw new ForbiddenException('Only the buyer funds milestones');
      if (contract.status !== 'active') throw new ConflictException('Milestones can be funded once the contract is active');
      const milestone = await this.lockMilestone(client, id, milestoneId);
      if (milestone.status !== 'pending') {
        throw new ConflictException(`A milestone that is '${milestone.status}' cannot be funded`);
      }
      const { rows: open } = await client.query<PaymentRow>(
        `SELECT * FROM escrow_payments WHERE milestone_id = $1 AND status = 'pending'`,
        [milestoneId],
      );
      const payment = open[0] ?? (await client.query<PaymentRow>(
        `INSERT INTO escrow_payments (contract_id, milestone_id, amount, currency, provider, status, created_by)
         VALUES ($1, $2, $3, $4, 'pending', 'pending', $5) RETURNING *`,
        [id, milestoneId, milestone.amount, contract.currency, user.id],
      )).rows[0];
      return { paymentId: payment.id, amount: Number(payment.amount), provider: payment.provider, status: payment.status };
    });
  }

  /**
   * Internal: a payment provider confirmed `providerPaymentId`. Marks the payment captured,
   * the milestone funded, adds the amount to the contract's escrow and writes an
   * 'Escrow hold' ledger row — all in one transaction.
   *
   * Idempotent: capturing an already-captured payment with the same provider id is a
   * no-op ({ alreadyCaptured: true }); provider_payment_id is UNIQUE, so one provider
   * payment can never fund two milestones.
   *
   * `paymentId` identifies our row when the provider id was not known when it was created
   * (the admin stand-in). The webhook will look payments up by provider id alone.
   */
  async markPaymentCaptured(providerPaymentId: string, paymentId?: string, actor = 'payment-provider'): Promise<CapturePaymentResult> {
    const outcome = await withTransaction(this.db, async (client) => {
      const { rows: found } = await client.query<PaymentRow>(
        paymentId
          ? `SELECT * FROM escrow_payments WHERE id = $1`
          : `SELECT * FROM escrow_payments WHERE provider_payment_id = $1`,
        [paymentId ?? providerPaymentId],
      );
      if (!found.length) throw new NotFoundException('Payment not found');

      // Lock in the usual order: contract, then payment, then milestone.
      const contract = await this.lockContract(client, found[0].contract_id);
      const { rows: locked } = await client.query<PaymentRow>(
        `SELECT * FROM escrow_payments WHERE id = $1 FOR UPDATE`,
        [found[0].id],
      );
      const payment = locked[0];
      const result: CapturePaymentResult = {
        paymentId: payment.id, milestoneId: payment.milestone_id, contractId: payment.contract_id,
        amount: Number(payment.amount), alreadyCaptured: false,
      };
      if (payment.status === 'captured') {
        if (payment.provider_payment_id === providerPaymentId) return { result: { ...result, alreadyCaptured: true }, notices: [] };
        throw new ConflictException('This payment was already captured under a different provider reference');
      }
      if (payment.status !== 'pending') throw new ConflictException(`A '${payment.status}' payment cannot be captured`);

      const milestone = await this.lockMilestone(client, contract.id, payment.milestone_id);
      if (contract.status !== 'active') {
        throw new ConflictException(`The contract is '${contract.status}'; this payment needs a refund, not a capture`);
      }
      if (milestone.status !== 'pending') throw new ConflictException(`The milestone is already '${milestone.status}'`);
      if (toMinor(Number(payment.amount)) !== toMinor(Number(milestone.amount))) {
        throw new ConflictException('The payment amount does not match the milestone');
      }

      try {
        const { rows: captured } = await client.query(
          `UPDATE escrow_payments
              SET status = 'captured', provider_payment_id = $2, captured_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = 'pending' RETURNING id`,
          [payment.id, providerPaymentId],
        );
        if (!captured.length) throw new ConflictException('The payment changed meanwhile');
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException('This provider payment was already used for another milestone');
        throw err;
      }
      await this.expectRow(client,
        `UPDATE contract_milestones SET status = 'funded', funded_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'pending' RETURNING id`,
        [milestone.id]);
      await this.expectRow(client,
        `UPDATE contracts SET escrow_funded = escrow_funded + $2, updated_at = NOW()
          WHERE id = $1 AND status = 'active' RETURNING id`,
        [contract.id, payment.amount]);
      await this.writeLedger(client, {
        tenantId: contract.tenant_id, userId: contract.buyer_id, payeeId: contract.expert_id,
        type: 'Escrow hold', amount: -Number(payment.amount), unit: contract.currency, by: actor,
        description: `Escrow hold: ${contract.id} milestone ${milestone.seq} (${milestone.title})`,
        ref: `${contract.id}/${milestone.id}`,
      });
      const amount = money(Number(payment.amount), contract.currency);
      const notices: Notice[] = [
        { userId: contract.buyer_id, text: `Payment of ${amount} received; milestone "${milestone.title}" is funded`, link: link(contract.id) },
        { userId: contract.expert_id, text: `Milestone "${milestone.title}" is funded (${amount} in escrow); you can start work`, link: link(contract.id) },
      ];
      return { result, notices };
    });
    await this.notify(outcome.notices);
    return outcome.result;
  }

  // ─── Milestone workflow ───────────────────────────────────────────────────

  /** Expert: funded | revision_requested → submitted. */
  submitMilestone(id: string, milestoneId: string, note: string, user: User) {
    return this.moveMilestone(id, milestoneId, 'submit', user, note);
  }

  /** Buyer: submitted → revision_requested. */
  requestRevision(id: string, milestoneId: string, note: string, user: User) {
    return this.moveMilestone(id, milestoneId, 'request_revision', user, note);
  }

  /** Buyer: submitted → accepted. */
  acceptMilestone(id: string, milestoneId: string, user: User) {
    return this.moveMilestone(id, milestoneId, 'accept', user);
  }

  /**
   * Buyer: accepted → released. In the same transaction: the contract's released total
   * grows, an 'Escrow release' ledger row credits the expert, and the contract completes
   * once every milestone is released (or cancelled).
   */
  releaseMilestone(id: string, milestoneId: string, user: User) {
    return this.moveMilestone(id, milestoneId, 'release', user);
  }

  private async moveMilestone(id: string, milestoneId: string, action: MilestoneAction, user: User, note?: string) {
    const notices = await withTransaction(this.db, async (client) => {
      const contract = await this.lockContract(client, id);
      const party = partyOf(contract, user);
      if (!isActor(party, action)) throw new ForbiddenException();
      if (contract.status !== 'active') throw new ConflictException(`The contract is '${contract.status}'`);
      const milestone = await this.lockMilestone(client, id, milestoneId);
      if (!canApply(action, milestone.status)) {
        throw new ConflictException(`Cannot ${action.replace('_', ' ')} a milestone that is '${milestone.status}'`);
      }
      const { to } = MILESTONE_ACTIONS[action];
      const set = {
        submit: `submitted_at = NOW(), submission_note = $3`,
        request_revision: `revision_count = revision_count + 1, revision_note = $3`,
        accept: `accepted_at = NOW()`,
        release: `released_at = NOW()`,
      }[action];
      const params: unknown[] = [milestoneId, milestone.status];
      if (note !== undefined) params.push(note.trim());
      await this.expectRow(client,
        `UPDATE contract_milestones SET status = '${to}', ${set}, updated_at = NOW()
          WHERE id = $1 AND status = $2 RETURNING id`,
        params);

      const otherId = party.isBuyer ? contract.expert_id : contract.buyer_id;
      const title = `"${milestone.title}"`;
      if (action !== 'release') {
        const text = {
          submit: `Milestone ${title} was submitted for your review`,
          request_revision: `Revision requested on milestone ${title}`,
          accept: `Milestone ${title} was accepted`,
        }[action];
        return [{ userId: otherId, text, link: link(id) }];
      }

      const amount = Number(milestone.amount);
      await this.expectRow(client,
        `UPDATE contracts SET released = released + $2, updated_at = NOW()
          WHERE id = $1 AND status = 'active' AND released + $2 <= escrow_funded RETURNING id`,
        [id, milestone.amount],
        'Not enough funds in escrow to release this milestone');
      await this.writeLedger(client, {
        tenantId: contract.tenant_id, userId: contract.expert_id, payeeId: contract.expert_id,
        type: 'Escrow release', amount, unit: contract.currency, by: user.id,
        description: `Escrow release: ${contract.id} milestone ${milestone.seq} (${milestone.title})`,
        ref: `${contract.id}/${milestone.id}`,
      });
      const { rows: open } = await client.query<{ open: string }>(
        `SELECT COUNT(*) AS open FROM contract_milestones
          WHERE contract_id = $1 AND status NOT IN ('released', 'cancelled')`,
        [id],
      );
      const out: Notice[] = [
        { userId: contract.expert_id, text: `${money(amount, contract.currency)} released for milestone ${title}`, link: link(id) },
      ];
      if (Number(open[0]?.open ?? 0) === 0) {
        // Completing the contract completes its project, in the same statement (and
        // transaction). A disputed or already-completed project keeps its stage.
        await client.query(
          `WITH done AS (
             UPDATE contracts SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = 'active'
             RETURNING project_id
           )
           UPDATE projects pj SET stage = 'Completed', updated_at = NOW()
             FROM done
            WHERE pj.id = done.project_id AND pj.stage NOT IN ('Completed', 'Disputed')`,
          [id],
        );
        out.push(...[contract.buyer_id, contract.expert_id].map((userId) => ({
          userId, text: `Contract ${id} is complete: every milestone has been released`, link: link(id),
        })));
      }
      return out;
    });
    await this.notify(notices);
    return this.findOne(id, user);
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────

  /**
   * The buyer, before any milestone is funded (no money held, no payment in progress past
   * 'pending'); an admin at any time before completion. Open milestones become 'cancelled'
   * and pending payment requests 'failed'. Refunding escrow_funded − released is a
   * payments-wave follow-up; the amount due is reported back.
   */
  async cancel(id: string, reason: string, user: User): Promise<Contract & { refundDue: number }> {
    const { contract, notices } = await withTransaction(this.db, async (client) => {
      const contract = await this.lockContract(client, id);
      const party = partyOf(contract, user);
      if (!party.isAdmin && !party.isBuyer) throw new ForbiddenException();
      if (!CANCELLABLE.includes(contract.status)) {
        throw new ConflictException(`A contract that is '${contract.status}' cannot be cancelled`);
      }
      if (!party.isAdmin) {
        if (!BUYER_CANCELLABLE.includes(contract.status)) {
          throw new ConflictException(`A '${contract.status}' contract can only be cancelled by an admin`);
        }
        const { rows } = await client.query<{ moved: string }>(
          `SELECT COUNT(*) AS moved FROM contract_milestones
            WHERE contract_id = $1 AND status NOT IN ('pending', 'cancelled')`,
          [id],
        );
        if (toMinor(Number(contract.escrow_funded)) > 0 || Number(rows[0]?.moved ?? 0) > 0) {
          throw new ConflictException('Money is already in escrow; ask an admin to cancel this contract');
        }
      }
      const { rows } = await client.query<ContractRow>(
        `UPDATE contracts SET status = 'cancelled', cancelled_by = $2, cancel_reason = $3, updated_at = NOW()
          WHERE id = $1 AND status = $4 RETURNING *`,
        [id, user.id, reason.trim(), contract.status],
      );
      if (!rows.length) throw new ConflictException('The contract changed meanwhile; reload and try again');
      await client.query(
        `UPDATE contract_milestones SET status = 'cancelled', updated_at = NOW()
          WHERE contract_id = $1 AND status NOT IN ('released', 'cancelled')`,
        [id],
      );
      await client.query(
        `UPDATE escrow_payments SET status = 'failed', updated_at = NOW() WHERE contract_id = $1 AND status = 'pending'`,
        [id],
      );
      const notices: Notice[] = [contract.buyer_id, contract.expert_id]
        .filter((userId) => userId !== user.id)
        .map((userId) => ({ userId, text: `Contract ${id} was cancelled: ${reason.trim()}`, link: link(id) }));
      return { contract: rows[0], notices };
    });
    await this.notify(notices);
    const refundDue = (toMinor(Number(contract.escrow_funded)) - toMinor(Number(contract.released))) / 100;
    return { ...(await this.findOne(id, user)), refundDue };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async lockContract(client: PoolClient, id: string): Promise<ContractRow> {
    const { rows } = await client.query<ContractRow>(`SELECT * FROM contracts WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.length) throw new NotFoundException(`Contract ${id} not found`);
    return rows[0];
  }

  private async lockMilestone(client: PoolClient, contractId: string, milestoneId: string): Promise<MilestoneRow> {
    const { rows } = await client.query<MilestoneRow>(
      `SELECT * FROM contract_milestones WHERE id = $1 AND contract_id = $2 FOR UPDATE`,
      [milestoneId, contractId],
    );
    if (!rows.length) throw new NotFoundException('Milestone not found');
    return rows[0];
  }

  /** A conditional UPDATE that must hit one row; otherwise the whole transaction rolls back. */
  private async expectRow(client: PoolClient, sql: string, params: unknown[], message = 'The contract changed meanwhile; reload and try again') {
    const { rows } = await client.query(sql, params);
    if (!rows.length) throw new ConflictException(message);
  }

  private async writeLedger(client: PoolClient, e: {
    tenantId: string | null; userId: string; payeeId: string; type: 'Escrow hold' | 'Escrow release';
    amount: number; unit: string; by: string; description: string; ref: string;
  }) {
    await client.query(
      `INSERT INTO ledger_entries (id, tenant_id, user_id, type, description, amount, unit, payee_id, by, ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [generateId('TX'), e.tenantId, e.userId, e.type, e.description, e.amount, e.unit, e.payeeId, e.by, e.ref],
    );
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
