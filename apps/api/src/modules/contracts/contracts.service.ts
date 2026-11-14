import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { Pagination } from '../../common/utils/pagination';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../invoices/invoices.service';
import { EmailService } from '../email/email.service';
import type { TemplateData } from '../email/templates';
import { PaymentProviderError } from '../payments/payment-provider';
import { PaymentsService, type RefundEvent } from '../payments/payments.service';
import type { FundMilestoneCheckout, IssueRefundResult, Refund } from '../payments/payment.types';
import {
  paymentTermsError, paymentTermsTotal, toMinor,
  type CapturePaymentResult, type Contract, type ContractStatus, type ContractSummary, type PaymentTerms,
} from './contract.types';
import {
  BUYER_CANCELLABLE, CANCELLABLE, canApply, isActor, MILESTONE_ACTIONS, MilestoneAction, normaliseName, partyOf,
} from './contract-rules';
import {
  ContractRow, mapContractRow, mapContractSummary, MilestoneRow, PaymentRow,
} from './contract.mapper';
import { CreateContractDto, IssueRefundDto } from './dto/contract.dto';

// A gig contract has no project, so the project join is a LEFT JOIN and the display title
// falls back to the contract's own title (the gig title).
const WITH_NAMES = `SELECT c.*, pj.title AS project_title, COALESCE(pj.title, c.title) AS display_title,
       CONCAT_WS(' ', b.first_name, b.last_name) AS buyer_name,
       CONCAT_WS(' ', e.first_name, e.last_name) AS expert_name
  FROM contracts c
  LEFT JOIN projects pj ON pj.id = c.project_id
  JOIN user_accounts b ON b.id = c.buyer_id
  JOIN user_accounts e ON e.id = c.expert_id`;

const link = (id: string) => `/platform/contracts/${id}`;
/** Milestone statuses whose amount is held in escrow (funded, not yet released). */
const HELD_MILESTONE_STATUSES: readonly string[] = ['funded', 'submitted', 'revision_requested', 'accepted'];
const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString('en-IN')}`;

/** Ledger `by` for money moved by the gig sweep instead of a person. */
export const AUTO_ACCEPT_ACTOR = 'system:gig-auto-accept';

interface Notice { userId: string; text: string; link: string }

/**
 * Extra work a caller (the gig orders module) runs inside the milestone move's own
 * transaction: `before` after the locks and state checks, to veto the move by throwing
 * (the revision limit); `after` once the milestone is updated, to write the caller's own rows.
 */
export interface MilestoneHooks {
  before?: (client: PoolClient, milestone: MilestoneRow) => Promise<void>;
  after?: (client: PoolClient) => Promise<void>;
}

interface RefundRow {
  id: string;
  contract_id: string;
  escrow_payment_id: string;
  amount: string | number;
  currency: string;
  provider_refund_id: string | null;
  status: 'pending' | 'processed' | 'failed';
  reason: string;
  error: string | null;
  created_at: Date | string;
  processed_at: Date | string | null;
}

function mapRefund(r: RefundRow): Refund {
  return {
    id: r.id, contractId: r.contract_id, escrowPaymentId: r.escrow_payment_id, amount: Number(r.amount),
    currency: r.currency, status: r.status, providerRefundId: r.provider_refund_id, reason: r.reason, error: r.error,
    createdAt: new Date(r.created_at).toISOString(), processedAt: r.processed_at ? new Date(r.processed_at).toISOString() : null,
  };
}

/**
 * Contracts between a buyer and the expert whose proposal they awarded.
 *
 * Every state or money change runs in one transaction that locks the contract row first
 * (SELECT … FOR UPDATE) and then makes conditional updates (`WHERE status = <expected>`),
 * so concurrent requests can't double-apply. Lock order is always contract → payment →
 * milestone, and contract → project → proposals when a cancel reopens the project (the
 * same project → proposals order as ProposalsService.award). Notifications go out after
 * COMMIT and never undo a committed change.
 */
@Injectable()
export class ContractsService implements OnModuleInit {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
    private readonly email: EmailService,
    private readonly invoices: InvoicesService,
  ) {}

  /** Razorpay confirmations (checkout verify and webhook) for escrow orders, and refund outcomes, land here. */
  onModuleInit() {
    this.payments.registerPurpose('escrow_milestone', {
      onPaid: async (order, providerPaymentId, actor) => {
        if (!order.escrow_payment_id) throw new ConflictException('Escrow order without an escrow payment');
        return this.markPaymentCaptured(providerPaymentId, order.escrow_payment_id, actor);
      },
    });
    this.payments.registerRefundHandler((event) => this.applyRefundEvent(event));
  }

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

  /**
   * The expert turns the contract down before signing it. No money can have moved yet, so
   * the proposal becomes 'Declined' and the project reopens for bids (see reopenProject).
   */
  async decline(id: string, reason: string | undefined, user: User): Promise<Contract> {
    const notices = await withTransaction(this.db, async (client) => {
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
      const declined = rows[0];
      return [
        { userId: declined.buyer_id, text: `The expert declined contract ${id}`, link: link(id) },
        ...(await this.reopenProject(client, declined, 'Declined')),
      ];
    });
    await this.notify(notices);
    return this.findOne(id, user);
  }

  // ─── Money ────────────────────────────────────────────────────────────────

  /**
   * The buyer asks to fund a pending milestone: opens an escrow_payments request (status
   * 'pending') and a Razorpay order for it, and returns what the web checkout needs. The
   * milestone stays 'pending' until the payment is captured (verify or webhook).
   *
   * Idempotent: a repeat call returns the open payment and its open order. Razorpay is
   * called only after the escrow row is committed, so no contract lock is held across the
   * network call; if Razorpay fails the escrow payment stays pending without an order and
   * the next call simply tries again.
   */
  async fundMilestone(id: string, milestoneId: string, user: User): Promise<FundMilestoneCheckout> {
    this.payments.assertConfigured();
    const payment = await withTransaction(this.db, async (client) => {
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
      if (open[0]) return open[0];
      try {
        const { rows } = await client.query<PaymentRow>(
          `INSERT INTO escrow_payments (contract_id, milestone_id, amount, currency, provider, status, created_by)
           VALUES ($1, $2, $3, $4, 'razorpay', 'pending', $5) RETURNING *`,
          [id, milestoneId, milestone.amount, contract.currency, user.id],
        );
        return rows[0];
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException('A payment for this milestone was just opened; try again');
        throw err;
      }
    });

    const amount = Number(payment.amount);
    const order = await this.payments.openOrder({
      purpose: 'escrow_milestone',
      escrowPaymentId: payment.id,
      userId: user.id,
      amountMinor: toMinor(amount),
      currency: payment.currency,
      receipt: payment.id,
      notes: { contractId: id, milestoneId, escrowPaymentId: payment.id },
    });
    if (!order.reused) {
      await this.db.query(
        `UPDATE escrow_payments SET provider = 'razorpay', provider_order_id = $2, updated_at = NOW()
          WHERE id = $1 AND status = 'pending'`,
        [payment.id, order.orderId],
      );
    }
    return {
      paymentId: payment.id, orderId: order.orderId, amount, amountMinor: order.amountMinor, currency: order.currency,
      keyId: order.keyId, provider: 'razorpay', status: 'pending',
    };
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
   * Called by PaymentsService (Razorpay checkout verify and webhook) with our escrow
   * payment id from the order. The two can race: both lock the contract row first, so the
   * second one finds the payment captured and returns { alreadyCaptured: true } (AUDIT-03).
   * Without `paymentId` the payment is looked up by provider id.
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
      // A payment the buyer started before a dispute froze the contract is still taken into
      // escrow (refusing it would leave the buyer's money with the provider).
      if (contract.status !== 'active' && contract.status !== 'disputed') {
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
          WHERE id = $1 AND status IN ('active', 'disputed') RETURNING id`,
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
    // The invoice is the buyer's receipt (it sends the invoice-issued email, so no separate
    // payment-received email goes out). It is created after COMMIT, outside the funding
    // transaction: a failure must not undo funding the buyer already paid for, and the
    // per-year counter lock must not be held that long. It is idempotent per payment, so a
    // verify/webhook retry on the already-captured path heals a missing invoice.
    try {
      await this.invoices.createForCapturedPayment(outcome.result.paymentId);
    } catch (err) {
      this.logger.warn(`Invoice for payment ${outcome.result.paymentId} could not be created: ${err instanceof Error ? err.message : String(err)}`);
    }
    return outcome.result;
  }

  // ─── Refunds ──────────────────────────────────────────────────────────────

  /**
   * Admin: pay contracts.refund_due back to the buyer through
   * Razorpay, against its captured Razorpay escrow payments, latest first (a payment is
   * never refunded beyond what is left of it). `amount` (optional) refunds part of what is
   * due; a later call refunds more. refund_due is set by an admin cancel (escrow still held)
   * or by a dispute resolution that refunds the buyer (DisputesService calls this right after
   * its own commit), so the contract may be cancelled, active, disputed or completed.
   *
   * 1. In one transaction holding the contract lock: refunds rows are inserted 'pending'.
   *    Pending rows reserve the money, so a second call (another admin, a double click)
   *    can only refund what is still unreserved.
   * 2. After COMMIT, one Razorpay refund per row (no locks held, never retried). A refused
   *    request marks its row 'failed', which frees the reservation. A timeout leaves it
   *    'pending': the refund webhook settles it (it is matched by notes.refundId).
   * 3. refunds become 'processed' only through applyRefundEvent (webhook, or Razorpay's
   *    own answer when it processes at once), which writes the 'Refund' ledger row and
   *    lowers refund_due exactly once per refund.
   */
  async issueRefund(id: string, dto: IssueRefundDto, user: User): Promise<IssueRefundResult> {
    if (user.role !== 'Admin') throw new ForbiddenException();
    this.payments.assertConfigured();
    const reason = dto.reason.trim();

    const planned = await withTransaction(this.db, async (client) => {
      const contract = await this.lockContract(client, id);
      const due = toMinor(Number(contract.refund_due));
      if (due <= 0) throw new ConflictException('Nothing is due to the buyer on this contract');
      const { rows: reservedRows } = await client.query<{ reserved: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS reserved FROM refunds WHERE contract_id = $1 AND status = 'pending'`,
        [id],
      );
      const available = due - toMinor(Number(reservedRows[0]?.reserved ?? 0));
      if (available <= 0) throw new ConflictException('Refunds for everything due are already in progress');
      const wanted = dto.amount !== undefined ? toMinor(dto.amount) : available;
      if (wanted <= 0) throw new BadRequestException('The refund amount must be positive');
      if (wanted > available) {
        throw new BadRequestException(`At most ${money(available / 100, contract.currency)} can be refunded now`);
      }

      const { rows: payments } = await client.query<{
        id: string; amount: string; currency: string; provider_payment_id: string; refunded: string;
      }>(
        `SELECT ep.id, ep.amount, ep.currency, ep.provider_payment_id,
                COALESCE(SUM(r.amount) FILTER (WHERE r.status <> 'failed'), 0) AS refunded
           FROM escrow_payments ep
           LEFT JOIN refunds r ON r.escrow_payment_id = ep.id
          WHERE ep.contract_id = $1 AND ep.status = 'captured' AND ep.provider = 'razorpay'
            AND ep.provider_payment_id IS NOT NULL
          GROUP BY ep.id
          ORDER BY ep.captured_at DESC NULLS LAST, ep.created_at DESC`,
        [id],
      );
      let left = wanted;
      const parts: { paymentId: string; providerPaymentId: string; minor: number; currency: string }[] = [];
      for (const p of payments) {
        if (left <= 0) break;
        const room = toMinor(Number(p.amount)) - toMinor(Number(p.refunded));
        if (room <= 0) continue;
        const take = Math.min(room, left);
        parts.push({ paymentId: p.id, providerPaymentId: p.provider_payment_id, minor: take, currency: p.currency });
        left -= take;
      }
      if (left > 0) {
        throw new ConflictException(
          `Only ${money((wanted - left) / 100, contract.currency)} of this can be refunded through Razorpay; `
          + 'the rest was not paid through Razorpay and must be refunded outside the app');
      }

      const rows: { row: RefundRow; providerPaymentId: string }[] = [];
      for (const part of parts) {
        const { rows: inserted } = await client.query<RefundRow>(
          `INSERT INTO refunds (contract_id, escrow_payment_id, amount, currency, provider, status, reason, requested_by)
           VALUES ($1, $2, $3, $4, 'razorpay', 'pending', $5, $6) RETURNING *`,
          [id, part.paymentId, part.minor / 100, part.currency, reason, user.id],
        );
        rows.push({ row: inserted[0], providerPaymentId: part.providerPaymentId });
      }
      await client.query(
        `INSERT INTO audit_log (actor_id, actor_name, role, action, entity, meta)
         VALUES ($1, $2, $3, 'Contract refund requested', $4, $5)`,
        [
          user.id, [user.firstName, user.lastName].filter(Boolean).join(' '), user.role, id,
          JSON.stringify({ amount: wanted / 100, currency: contract.currency, reason, refunds: rows.map((r) => r.row.id) }),
        ],
      );
      return rows;
    });

    for (const { row, providerPaymentId } of planned) {
      try {
        const refund = await this.payments.refund({
          paymentId: providerPaymentId,
          amountMinor: toMinor(Number(row.amount)),
          receipt: row.id,
          notes: { refundId: row.id, contractId: id },
        });
        await this.db.query(
          `UPDATE refunds SET provider_refund_id = $2, updated_at = NOW() WHERE id = $1 AND provider_refund_id IS NULL`,
          [row.id, refund.id],
        );
        if (refund.status !== 'pending') {
          await this.applyRefundEvent({
            providerRefundId: refund.id, refundId: row.id, status: refund.status, actor: `admin:${user.id}`,
            error: refund.status === 'failed' ? 'Razorpay reported the refund as failed' : undefined,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof PaymentProviderError && err.kind === 'rejected') {
          await this.db.query(
            `UPDATE refunds SET status = 'failed', error = $2, processed_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND status = 'pending'`,
            [row.id, message.slice(0, 1000)],
          );
        } else {
          // Unknown outcome: keep it pending (and reserved) until the webhook says what happened.
          await this.db.query(
            `UPDATE refunds SET error = $2, updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
            [row.id, `Outcome unknown, waiting for Razorpay: ${message}`.slice(0, 1000)],
          ).catch(() => undefined);
        }
        this.logger.warn(`Refund ${row.id} for contract ${id}: ${message}`);
      }
    }

    const ids = planned.map((p) => p.row.id);
    const { rows: refunds } = await this.db.query<RefundRow>(
      `SELECT * FROM refunds WHERE id = ANY($1::uuid[]) ORDER BY created_at`,
      [ids],
    );
    const { rows: after } = await this.db.query<{ refund_due: string }>(`SELECT refund_due FROM contracts WHERE id = $1`, [id]);
    return { contractId: id, refunds: refunds.map(mapRefund), refundDue: Number(after[0]?.refund_due ?? 0) };
  }

  /**
   * A refund outcome from Razorpay (webhook, or the refund call's own answer). 'processed'
   * marks the row processed, lowers contracts.refund_due and writes a 'Refund' ledger row
   * to the buyer, in one transaction and only once (a replay finds the row processed).
   * 'failed' marks a pending row failed, freeing its reservation for another attempt.
   * Refunds we did not start (e.g. from the Razorpay dashboard) are logged and ignored.
   */
  async applyRefundEvent(event: RefundEvent): Promise<void> {
    const notices = await withTransaction(this.db, async (client) => {
      const { rows: found } = await client.query<RefundRow>(
        event.refundId
          ? `SELECT * FROM refunds WHERE provider_refund_id = $1 OR id = $2::uuid ORDER BY (provider_refund_id = $1) DESC NULLS LAST LIMIT 1`
          : `SELECT * FROM refunds WHERE provider_refund_id = $1`,
        event.refundId ? [event.providerRefundId, event.refundId] : [event.providerRefundId],
      );
      if (!found.length) {
        this.logger.warn(`Razorpay refund ${event.providerRefundId} does not match a refund we issued; ignored`);
        return [];
      }
      const contract = await this.lockContract(client, found[0].contract_id);
      const { rows: locked } = await client.query<RefundRow>(`SELECT * FROM refunds WHERE id = $1 FOR UPDATE`, [found[0].id]);
      const refund = locked[0];
      if (refund.provider_refund_id && refund.provider_refund_id !== event.providerRefundId) {
        throw new ConflictException(`Refund ${refund.id} belongs to another Razorpay refund`);
      }

      if (event.status === 'failed') {
        await client.query(
          `UPDATE refunds SET status = 'failed', error = $3, provider_refund_id = COALESCE(provider_refund_id, $2),
                  processed_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = 'pending'`,
          [refund.id, event.providerRefundId, (event.error ?? 'Refund failed').slice(0, 1000)],
        );
        return [];
      }

      if (refund.status === 'processed') return []; // replay
      await this.expectRow(client,
        `UPDATE refunds SET status = 'processed', provider_refund_id = COALESCE(provider_refund_id, $2), error = NULL,
                processed_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status <> 'processed' RETURNING id`,
        [refund.id, event.providerRefundId]);
      const amount = Number(refund.amount);
      if (toMinor(Number(contract.refund_due)) < toMinor(amount)) {
        this.logger.warn(`Refund ${refund.id} exceeds the refund due on ${contract.id}; refund_due floors at 0`);
      }
      await client.query(
        `UPDATE contracts SET refund_due = GREATEST(refund_due - $2, 0), updated_at = NOW() WHERE id = $1`,
        [contract.id, refund.amount],
      );
      await this.writeLedger(client, {
        tenantId: contract.tenant_id, userId: contract.buyer_id, payeeId: contract.buyer_id,
        type: 'Refund', amount, unit: refund.currency, by: event.actor,
        description: `Refund: ${contract.id} (${refund.reason.slice(0, 200)})`,
        ref: `${contract.id}/refund/${refund.id}`,
      });
      const formatted = money(amount, refund.currency);
      await this.emailUser(client, contract.buyer_id, 'refund-issued', (firstName) => ({
        firstName, amount: formatted, contractId: contract.id, path: link(contract.id),
      }), `refund-issued:${refund.id}`);
      return [{
        userId: contract.buyer_id,
        text: `A refund of ${formatted} for contract ${contract.id} has been processed`,
        link: link(contract.id),
      }];
    });
    await this.notify(notices);
  }

  // ─── Milestone workflow ───────────────────────────────────────────────────

  /** Expert: funded | revision_requested → submitted. */
  submitMilestone(id: string, milestoneId: string, note: string, user: User, hooks?: MilestoneHooks) {
    return this.moveMilestone(id, milestoneId, 'submit', user, note, hooks);
  }

  /** Buyer: submitted → revision_requested. */
  requestRevision(id: string, milestoneId: string, note: string, user: User, hooks?: MilestoneHooks) {
    return this.moveMilestone(id, milestoneId, 'request_revision', user, note, hooks);
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

  /**
   * Buyer: submitted → released in one transaction (accepted_at and released_at both set),
   * with the same release bookkeeping as release: released total, 'Escrow release' ledger
   * row crediting the expert, completion once every milestone is settled.
   */
  approveAndRelease(id: string, milestoneId: string, user: User) {
    return this.moveMilestone(id, milestoneId, 'approve_release', user);
  }

  /**
   * System: a delivered (submitted) milestone nobody reviewed in time is accepted and
   * released in one transaction, with the contract locked. Same bookkeeping as accept +
   * release by the buyer (released total, 'Escrow release' ledger row, completion), but the
   * ledger rows carry by = 'system:gig-auto-accept' and an audit_log row records why.
   * Returns false (doing nothing) when the milestone is no longer submitted or the contract
   * is no longer active (disputed, cancelled, already settled). Callers notify the parties.
   */
  async autoAcceptAndRelease(contractId: string, milestoneId: string, reason: string): Promise<boolean> {
    return withTransaction(this.db, async (client) => {
      const contract = await this.lockContract(client, contractId);
      if (contract.status !== 'active') return false;
      const milestone = await this.lockMilestone(client, contractId, milestoneId);
      if (milestone.status !== 'submitted') return false;
      await this.expectRow(client,
        `UPDATE contract_milestones SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'submitted' RETURNING id`,
        [milestoneId]);
      await this.expectRow(client,
        `UPDATE contract_milestones SET status = 'released', released_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'accepted' RETURNING id`,
        [milestoneId]);
      await this.creditRelease(client, contract, milestone, milestone.amount, 'active', AUTO_ACCEPT_ACTOR, 'Escrow release (auto-accepted)');
      const completed = await this.completeIfSettled(client, contractId, 'active');
      await client.query(
        `INSERT INTO audit_log (actor_id, actor_name, role, action, entity, meta)
         VALUES (NULL, 'System', 'System', 'Gig order auto-accepted', $1, $2)`,
        [`contract:${contractId}`, JSON.stringify({ milestoneId, amount: Number(milestone.amount), reason, completed })],
      );
      return true;
    });
  }

  private async moveMilestone(
    id: string, milestoneId: string, action: MilestoneAction, user: User, note?: string, hooks?: MilestoneHooks,
  ) {
    const notices = await withTransaction(this.db, async (client) => {
      const contract = await this.lockContract(client, id);
      const party = partyOf(contract, user);
      if (!isActor(party, action)) throw new ForbiddenException();
      if (contract.status !== 'active') throw new ConflictException(`The contract is '${contract.status}'`);
      const milestone = await this.lockMilestone(client, id, milestoneId);
      if (!canApply(action, milestone.status)) {
        throw new ConflictException(`Cannot ${action.replace('_', ' ')} a milestone that is '${milestone.status}'`);
      }
      if (hooks?.before) await hooks.before(client, milestone);
      const { to } = MILESTONE_ACTIONS[action];
      const set = {
        submit: `submitted_at = NOW(), submission_note = $3`,
        request_revision: `revision_count = revision_count + 1, revision_note = $3`,
        accept: `accepted_at = NOW()`,
        release: `released_at = NOW()`,
        approve_release: `accepted_at = NOW(), released_at = NOW()`,
      }[action];
      const params: unknown[] = [milestoneId, milestone.status];
      if (note !== undefined) params.push(note.trim());
      await this.expectRow(client,
        `UPDATE contract_milestones SET status = '${to}', ${set}, updated_at = NOW()
          WHERE id = $1 AND status = $2 RETURNING id`,
        params);

      if (hooks?.after) await hooks.after(client);
      const otherId = party.isBuyer ? contract.expert_id : contract.buyer_id;
      const title = `"${milestone.title}"`;
      if (action !== 'release' && action !== 'approve_release') {
        const text = {
          submit: `Milestone ${title} was submitted for your review`,
          request_revision: `Revision requested on milestone ${title}`,
          accept: `Milestone ${title} was accepted`,
        }[action];
        return [{ userId: otherId, text, link: link(id) }];
      }

      const amount = Number(milestone.amount);
      await this.creditRelease(client, contract, milestone, milestone.amount, 'active', user.id, 'Escrow release');
      const out: Notice[] = [
        { userId: contract.expert_id, text: `${money(amount, contract.currency)} released for milestone ${title}`, link: link(id) },
      ];
      if (await this.completeIfSettled(client, id, 'active')) {
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
   * and pending payment requests 'failed'.
   *
   * Escrow still held (escrow_funded − released − refunds already processed, e.g. after a
   * dispute refunded the buyer) is recorded as contracts.refund_due in the
   * same UPDATE, audited, and the buyer is told; an admin then pays it out through Razorpay
   * with issueRefund. When no money moved at all, the proposal becomes 'Withdrawn' and the
   * project reopens for bids (see reopenProject).
   */
  async cancel(id: string, reason: string, user: User): Promise<Contract> {
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
        `UPDATE contracts
            SET status = 'cancelled', cancelled_by = $2, cancel_reason = $3,
                refund_due = GREATEST(escrow_funded - released - (
                  SELECT COALESCE(SUM(r.amount), 0) FROM refunds r WHERE r.contract_id = $1 AND r.status = 'processed'
                ), 0),
                updated_at = NOW()
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
      const cancelled = rows[0];
      const notices: Notice[] = [contract.buyer_id, contract.expert_id]
        .filter((userId) => userId !== user.id)
        .map((userId) => ({ userId, text: `Contract ${id} was cancelled: ${reason.trim()}`, link: link(id) }));

      const refundDue = Number(cancelled.refund_due ?? 0);
      if (toMinor(refundDue) > 0) {
        await client.query(
          `INSERT INTO audit_log (actor_id, actor_name, role, action, entity, meta)
           VALUES ($1, $2, $3, 'Contract cancelled with refund due', $4, $5)`,
          [
            user.id, [user.firstName, user.lastName].filter(Boolean).join(' '), user.role, id,
            JSON.stringify({ amount: refundDue, currency: cancelled.currency, reason: reason.trim() }),
          ],
        );
        notices.push({
          userId: cancelled.buyer_id,
          text: `A refund of ${money(refundDue, cancelled.currency)} is due to you for cancelled contract ${id}`,
          link: link(id),
        });
      }
      notices.push(...(await this.reopenProject(client, cancelled, 'Withdrawn')));
      return { contract: cancelled, notices };
    });
    await this.notify(notices);
    return this.findOne(contract.id, user);
  }

  /**
   * After a contract is cancelled or declined: when no money ever moved (nothing funded,
   * nothing released, no captured payment), the awarded proposal gets `proposalStatus`, the
   * bids the award had rejected return to 'Pending', and the project goes back to 'Open for
   * Bids' so the buyer can award someone else. Otherwise the project is left as it is (the
   * money has to be settled first). Locks the project, then its proposals (the order
   * ProposalsService.award uses), after the contract the caller already holds.
   */
  private async reopenProject(
    client: PoolClient, contract: ContractRow, proposalStatus: 'Declined' | 'Withdrawn',
  ): Promise<Notice[]> {
    // A gig contract has no project or proposal to reopen.
    if (!contract.project_id || !contract.proposal_id) return [];
    if (toMinor(Number(contract.escrow_funded)) > 0 || toMinor(Number(contract.released)) > 0) return [];
    const { rows: captured } = await client.query(
      `SELECT 1 FROM escrow_payments WHERE contract_id = $1 AND status = 'captured' LIMIT 1`,
      [contract.id],
    );
    if (captured.length) return [];

    // Guarded by awarded_to: a project already reopened or awarded to someone else is left alone.
    const { rows: projects } = await client.query<{ title: string }>(
      `SELECT title FROM projects WHERE id = $1 AND awarded_to = $2 FOR UPDATE`,
      [contract.project_id, contract.expert_id],
    );
    if (!projects.length) return [];
    await client.query(
      `UPDATE proposals
          SET status = CASE WHEN id = $2 THEN $3 ELSE 'Pending' END, updated_at = NOW()
        WHERE project_id = $1 AND (id = $2 OR status = 'Rejected')`,
      [contract.project_id, contract.proposal_id, proposalStatus],
    );
    await this.expectRow(client,
      `UPDATE projects SET awarded_to = NULL, stage = 'Open for Bids', updated_at = NOW()
        WHERE id = $1 AND awarded_to = $2 RETURNING id`,
      [contract.project_id, contract.expert_id]);
    return [{
      userId: contract.buyer_id,
      text: `Project "${projects[0].title}" is open for bids again; you can award another proposal`,
      link: '/platform/projects',
    }];
  }

  // ─── Disputes (internal: DisputesService calls these inside its transaction) ──

  /** Locks the contract row (FOR UPDATE) in the caller's transaction. */
  lockForDispute(client: PoolClient, id: string): Promise<ContractRow> {
    return this.lockContract(client, id);
  }

  /** Locks one milestone of the contract (after the contract: the usual lock order). */
  lockMilestoneForDispute(client: PoolClient, contractId: string, milestoneId: string): Promise<MilestoneRow> {
    return this.lockMilestone(client, contractId, milestoneId);
  }

  /**
   * Freezes an active contract while a dispute is open: status 'disputed', which blocks
   * funding, milestone moves and release (they all require 'active') and a buyer cancel
   * (BUYER_CANCELLABLE). Already 'disputed' (another open dispute): nothing to do.
   * Caller holds the contract lock.
   */
  async freezeForDispute(client: PoolClient, contract: ContractRow): Promise<void> {
    if (contract.status === 'disputed') return;
    if (contract.status !== 'active') {
      throw new ConflictException(`A dispute can only be raised on an active contract (this one is '${contract.status}')`);
    }
    await this.expectRow(client,
      `UPDATE contracts SET status = 'disputed', updated_at = NOW() WHERE id = $1 AND status = 'active' RETURNING id`,
      [contract.id]);
  }

  /**
   * Admin resolution of a disputed milestone: `toExpert` is released to the expert with the
   * same bookkeeping as a normal release (released total + 'Escrow release' ledger row);
   * `toBuyer` is added to contracts.refund_due, which issueRefund pays out after the caller
   * commits. The two must add up to the milestone's held amount (its full amount: a
   * milestone is funded by one captured payment of exactly its amount). The milestone ends
   * 'released' when the expert got anything, otherwise 'cancelled'.
   *
   * Runs in the caller's transaction; the contract must be 'disputed'.
   */
  async settleMilestoneByAdmin(
    client: PoolClient, contractId: string, milestoneId: string,
    share: { toExpert: number; toBuyer: number }, actor: User, disputeId: string,
  ): Promise<{ toExpert: number; toBuyer: number }> {
    const contract = await this.lockContract(client, contractId);
    if (contract.status !== 'disputed') throw new ConflictException(`The contract is '${contract.status}', not disputed`);
    const milestone = await this.lockMilestone(client, contractId, milestoneId);
    if (!HELD_MILESTONE_STATUSES.includes(milestone.status)) {
      throw new ConflictException(`Milestone "${milestone.title}" is '${milestone.status}'; no escrow is held on it`);
    }
    const expertMinor = toMinor(share.toExpert);
    const buyerMinor = toMinor(share.toBuyer);
    if (expertMinor < 0 || buyerMinor < 0 || expertMinor + buyerMinor !== toMinor(Number(milestone.amount))) {
      throw new BadRequestException(
        `The amounts must add up to the ${money(Number(milestone.amount), contract.currency)} held on "${milestone.title}"`);
    }
    if (expertMinor > 0) {
      await this.creditRelease(client, contract, milestone, expertMinor / 100, 'disputed', actor.id,
        `Escrow release (dispute ${disputeId})`);
    }
    if (buyerMinor > 0) {
      await this.expectRow(client,
        `UPDATE contracts SET refund_due = refund_due + $2, updated_at = NOW()
          WHERE id = $1 AND status = 'disputed' RETURNING id`,
        [contractId, buyerMinor / 100]);
    }
    await this.expectRow(client,
      expertMinor > 0
        ? `UPDATE contract_milestones SET status = 'released', released_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = $2 RETURNING id`
        : `UPDATE contract_milestones SET status = 'cancelled', updated_at = NOW()
            WHERE id = $1 AND status = $2 RETURNING id`,
      [milestoneId, milestone.status]);
    return { toExpert: expertMinor / 100, toBuyer: buyerMinor / 100 };
  }

  /** Admin resolution: release a disputed milestone's whole held amount to the expert. */
  async releaseByAdmin(contractId: string, milestoneId: string, actor: User, client: PoolClient, disputeId = 'admin') {
    const milestone = await this.lockMilestone(client, contractId, milestoneId);
    return this.settleMilestoneByAdmin(client, contractId, milestoneId,
      { toExpert: Number(milestone.amount), toBuyer: 0 }, actor, disputeId);
  }

  /**
   * After the last open dispute on a contract closes: 'disputed' → 'completed' when every
   * milestone is released or cancelled (completing the project like a normal release),
   * otherwise back to 'active'. A contract that is no longer 'disputed' (an admin cancelled
   * it meanwhile) keeps its status. Returns the resulting status. Caller's transaction.
   */
  async restoreAfterDispute(client: PoolClient, contractId: string): Promise<ContractStatus> {
    const contract = await this.lockContract(client, contractId);
    if (contract.status !== 'disputed') return contract.status;
    if (await this.completeIfSettled(client, contractId, 'disputed')) return 'completed';
    await this.expectRow(client,
      `UPDATE contracts SET status = 'active', updated_at = NOW() WHERE id = $1 AND status = 'disputed' RETURNING id`,
      [contractId]);
    return 'active';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Adds `amount` to the contract's released total and credits the expert in the ledger. */
  private async creditRelease(
    client: PoolClient, contract: ContractRow, milestone: MilestoneRow, amount: string | number,
    contractStatus: 'active' | 'disputed', by: string, label: string,
  ) {
    await this.expectRow(client,
      `UPDATE contracts SET released = released + $2, updated_at = NOW()
        WHERE id = $1 AND status = $3 AND released + $2 <= escrow_funded RETURNING id`,
      [contract.id, amount, contractStatus],
      'Not enough funds in escrow to release this milestone');
    await this.writeLedger(client, {
      tenantId: contract.tenant_id, userId: contract.expert_id, payeeId: contract.expert_id,
      type: 'Escrow release', amount: Number(amount), unit: contract.currency, by,
      description: `${label}: ${contract.id} milestone ${milestone.seq} (${milestone.title})`,
      ref: `${contract.id}/${milestone.id}`,
    });
  }

  /**
   * When no milestone is left open, completes the contract (from status `from`) and its
   * project in one statement (and the caller's transaction). A disputed or
   * already-completed project keeps its stage.
   */
  private async completeIfSettled(client: PoolClient, id: string, from: 'active' | 'disputed'): Promise<boolean> {
    const { rows: open } = await client.query<{ open: string }>(
      `SELECT COUNT(*) AS open FROM contract_milestones
        WHERE contract_id = $1 AND status NOT IN ('released', 'cancelled')`,
      [id],
    );
    if (Number(open[0]?.open ?? 0) !== 0) return false;
    await client.query(
      `WITH done AS (
         UPDATE contracts SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = $2
         RETURNING project_id
       )
       UPDATE projects pj SET stage = 'Completed', updated_at = NOW()
         FROM done
        WHERE pj.id = done.project_id AND pj.stage NOT IN ('Completed', 'Disputed')`,
      [id, from],
    );
    return true;
  }

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

  /** Queues a templated email to `userId` inside the caller's transaction (sent only if it commits). */
  private async emailUser<K extends 'payment-received' | 'refund-issued'>(
    client: PoolClient, userId: string, template: K, data: (firstName: string) => TemplateData[K], dedupeKey: string,
  ) {
    const { rows } = await client.query<{ email: string | null; first_name: string | null }>(
      `SELECT email, first_name FROM user_accounts WHERE id = $1`,
      [userId],
    );
    if (!rows[0]?.email) return;
    await this.email.enqueue(template, rows[0].email, data(rows[0].first_name ?? ''), { userId, dedupeKey, client });
  }

  private async writeLedger(client: PoolClient, e: {
    tenantId: string | null; userId: string; payeeId: string; type: 'Escrow hold' | 'Escrow release' | 'Refund';
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
