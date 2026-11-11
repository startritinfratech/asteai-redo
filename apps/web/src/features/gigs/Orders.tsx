'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { GIG_LIMITS as L, GIG_ORDER_STATUSES, type GigOrder, type GigOrderStatus } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button, Chips, Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';
import { gigsApi, orderKey } from './api';
import { formatDate, inr, ORDER_STATUS_COLOR, ORDER_STATUS_LABEL, TIER_LABEL, timeline } from './format';
import styles from './Gigs.module.css';

type Filter = GigOrderStatus | 'all';

/** /platform/orders: the orders the signed-in user placed or fulfils (admins: all). */
export function OrdersList() {
  const user = useAuthStore((s) => s.user);
  const [filter, setFilter] = useState<Filter>('all');
  const key = filter === 'all' ? '/orders' : `/orders?status=${encodeURIComponent(filter)}`;
  const { data, error, isLoading } = useSWR<GigOrder[]>(key, fetcher);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Marketplace"
        title="Orders"
        sub={user?.role === 'Freelancer' ? 'Orders buyers placed on your services.' : 'Pre-packaged services you ordered.'}
      />
      <Chips
        label="Filter by status"
        value={filter}
        onChange={setFilter}
        options={[{ id: 'all' as Filter, label: 'All' }, ...GIG_ORDER_STATUSES.map((s) => ({ id: s as Filter, label: ORDER_STATUS_LABEL[s] }))]}
      />
      {isLoading && <Empty message="Loading orders…" />}
      {error && <Empty message={errorMessage(error, 'Could not load orders.')} />}
      {data && data.length === 0 && <Empty message={filter === 'all' ? 'No orders yet.' : 'No orders with this status.'} />}
      <div className={styles.stack}>
        {data?.map((o) => (
          <Link key={o.id} href={`/platform/orders/${encodeURIComponent(o.id)}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Panel className={styles.stack}>
              <div className={styles.between}>
                <span className={styles.h2}>{o.serviceTitle}</span>
                <span className={styles.row}>
                  {o.overdue && <Tag color="rose">Overdue</Tag>}
                  <Tag color={ORDER_STATUS_COLOR[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Tag>
                </span>
              </div>
              <div className={styles.between}>
                <span className={styles.muted}>
                  {user?.id === o.buyerId ? `Expert: ${o.expertName}` : user?.id === o.expertId ? `Buyer: ${o.buyerName}` : `${o.buyerName} to ${o.expertName}`}
                  {' · '}<span className={styles.mono}>{o.id}</span> · {TIER_LABEL[o.packageTier]}
                </span>
                <span className={styles.mono}>{inr(o.price)}</span>
              </div>
            </Panel>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** /platform/orders/[id]: timeline, delivery history and the actions for the caller's side. */
export function OrderDetail({ id }: { id: string }) {
  const user = useAuthStore((s) => s.user);
  const { data: order, error, isLoading, mutate } = useSWR<GigOrder>(orderKey(id), fetcher);
  if (isLoading) return <Empty message="Loading order…" />;
  if (error || !order) return <Empty message={errorMessage(error, 'Could not load this order.')} />;

  const side = user?.id === order.buyerId ? 'buyer' : user?.id === order.expertId ? 'expert' : user?.role === 'Admin' ? 'admin' : null;
  const done = (next?: GigOrder) => { void mutate(next, { revalidate: true }); };
  const contractHref = order.contractId ? `/platform/contracts/${encodeURIComponent(order.contractId)}` : null;
  const revisionsLeft = Math.max(0, order.revisions - order.revisionsUsed);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Order"
        title={order.serviceTitle}
        sub={<span className={styles.mono}>{order.id}</span>}
        actions={<Link href="/platform/orders">All orders</Link>}
      />

      <Panel className={styles.stack}>
        <div className={styles.between}>
          <h2 className={styles.h2}>{order.buyerName} and {order.expertName}</h2>
          <span className={styles.row}>
            {order.overdue && <Tag color="rose">Overdue</Tag>}
            <Tag color={ORDER_STATUS_COLOR[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Tag>
          </span>
        </div>
        <dl className={styles.facts}>
          <div><dt>Package</dt><dd>{TIER_LABEL[order.packageTier]}: {order.packageName}</dd></div>
          <div><dt>Price</dt><dd className={styles.mono}>{inr(order.price)}</dd></div>
          <div><dt>Delivery</dt><dd>{order.deliveryDays} days{order.dueAt ? `, due ${formatDate(order.dueAt)}` : ''}</dd></div>
          {order.autoAcceptAt && <div><dt>Auto-accepts</dt><dd>Auto-accepts on {formatDate(order.autoAcceptAt)}</dd></div>}
          <div><dt>Revisions</dt><dd>{order.revisionsUsed} of {order.revisions} used</dd></div>
          <div><dt>Ordered</dt><dd>{formatDate(order.createdAt)}</dd></div>
          <div><dt>Terms accepted</dt><dd>{formatDate(order.acceptedTermsAt)}</dd></div>
        </dl>
        <ol className={styles.timeline} aria-label="Order progress">
          {timeline(order.status).map((s) => (
            <li key={s.label} className={styles.step} data-done={s.done} data-current={s.current}>{s.label}</li>
          ))}
        </ol>
        {order.overdue && (
          <p className={styles.notice}>
            Delivery is overdue.{side === 'buyer' ? ' You can open a dispute from the contract if the expert does not deliver.' : ''}
          </p>
        )}
        {order.status === 'revision_requested' && <p className={styles.notice}>The buyer asked for a revision; the expert will deliver again.</p>}
        {contractHref && (
          <div className={styles.row}>
            <Link href={contractHref}>Open the contract (payment, escrow, disputes)</Link>
            <Link href="/platform/messages">Messages</Link>
          </div>
        )}
      </Panel>

      <Panel className={styles.stack}>
        <h2 className={styles.h2}>Requirements</h2>
        <p className={styles.note}>{order.requirements}</p>
      </Panel>

      {order.deliveries && order.deliveries.length > 0 && (
        <Panel className={styles.stack}>
          <h2 className={styles.h2}>Deliveries</h2>
          {order.deliveries.map((d) => (
            <div key={d.id} className={styles.stack}>
              <span className={styles.muted}>{formatDate(d.createdAt)}</span>
              <p className={styles.note}>{d.note}</p>
              {d.links.length > 0 && (
                <ul className={styles.links}>
                  {d.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noopener noreferrer">{l}</a></li>)}
                </ul>
              )}
            </div>
          ))}
        </Panel>
      )}

      {side === 'buyer' && order.status === 'awaiting_payment' && contractHref && <PayPanel order={order} href={contractHref} onDone={done} />}
      {side === 'expert' && order.status === 'awaiting_payment' && <p className={styles.notice}>Waiting for the buyer to pay into escrow. You can start once it is funded.</p>}
      {side === 'expert' && (order.status === 'in_progress' || order.status === 'revision_requested') && <DeliverPanel order={order} onDone={done} />}
      {side === 'buyer' && order.status === 'delivered' && <ReviewDeliveryPanel order={order} revisionsLeft={revisionsLeft} onDone={done} />}
      {side === 'buyer' && order.status === 'completed' && !order.reviewed && <ReviewPanel order={order} onDone={done} />}
      {order.status === 'completed' && order.reviewed && <p className={styles.ok}>Reviewed. Thank you.</p>}
    </div>
  );
}

/** Runs an action with busy / error state; the confirm steps below call it. */
function useAction(onDone: (o?: GigOrder) => void) {
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const run = async (fn: () => Promise<GigOrder>) => {
    setBusy(true);
    setFail(null);
    try {
      onDone(await fn());
      return true;
    } catch (err) {
      setFail(errorMessage(err, 'That did not work.'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, fail, run };
}

function PayPanel({ order, href, onDone }: { order: GigOrder; href: string; onDone: (o?: GigOrder) => void }) {
  const { busy, fail, run } = useAction(onDone);
  const [confirm, setConfirm] = useState(false);
  return (
    <Panel className={styles.stack}>
      <h2 className={styles.h2}>Payment</h2>
      <p className={styles.notice}>This order starts when you pay {inr(order.price)} into escrow. The money is released to the expert only when you accept the delivery.</p>
      {fail && <p className={styles.error} role="alert">{fail}</p>}
      <div className={styles.row}>
        <Link href={href}>Go to the contract to pay</Link>
        {!confirm && <Button variant="sm" onClick={() => setConfirm(true)}>Cancel order</Button>}
      </div>
      {confirm && (
        <div className={styles.confirm}>
          <b>Cancel this order?</b>
          <span className={styles.muted}>Nothing has been paid, so nothing is charged. This cannot be undone.</span>
          <div className={styles.row}>
            <Button variant="sm" onClick={() => setConfirm(false)} disabled={busy}>Keep order</Button>
            <Button variant={['sm', 'rose']} disabled={busy} onClick={() => run(() => gigsApi.cancel(order.id))}>Yes, cancel</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function DeliverPanel({ order, onDone }: { order: GigOrder; onDone: (o?: GigOrder) => void }) {
  const { busy, fail, run } = useAction(onDone);
  const [note, setNote] = useState('');
  const [links, setLinks] = useState('');
  const list = links.split('\n').map((l) => l.trim()).filter(Boolean);
  const badLink = list.find((l) => !/^https:\/\/[^\s/]+\.[^\s/]+/.test(l));
  return (
    <Panel className={styles.form}>
      <h2 className={styles.h2}>{order.status === 'revision_requested' ? 'Deliver the revision' : 'Deliver the work'}</h2>
      <Field label="Delivery note"><textarea rows={5} value={note} maxLength={L.deliveryNote} onChange={(e) => setNote(e.target.value)} /></Field>
      <Field label="Links to the work (https, one per line, up to 10)">
        <textarea rows={3} value={links} onChange={(e) => setLinks(e.target.value)} />
      </Field>
      {badLink && <p className={styles.error}>Links must start with https://: {badLink.slice(0, 60)}</p>}
      {list.length > L.links && <p className={styles.error}>At most {L.links} links.</p>}
      {fail && <p className={styles.error} role="alert">{fail}</p>}
      <div className={styles.row}>
        <Button variant="primary" disabled={busy || !note.trim() || Boolean(badLink) || list.length > L.links}
          onClick={async () => { if (await run(() => gigsApi.deliver(order.id, note.trim(), list))) { setNote(''); setLinks(''); } }}>
          {busy ? 'Delivering…' : 'Deliver'}
        </Button>
      </div>
    </Panel>
  );
}

function ReviewDeliveryPanel({ order, revisionsLeft, onDone }: { order: GigOrder; revisionsLeft: number; onDone: (o?: GigOrder) => void }) {
  const { busy, fail, run } = useAction(onDone);
  const [mode, setMode] = useState<'none' | 'accept' | 'revise'>('none');
  const [note, setNote] = useState('');
  return (
    <Panel className={styles.stack}>
      <h2 className={styles.h2}>Review the delivery</h2>
      <p className={styles.muted}>
        Accepting releases {inr(order.price)} from escrow to the expert. You can ask for a revision instead ({revisionsLeft} left on this package).
        If something is wrong, open a dispute from the contract.
      </p>
      {fail && <p className={styles.error} role="alert">{fail}</p>}
      {mode === 'none' && (
        <div className={styles.row}>
          <Button variant="primary" onClick={() => setMode('accept')}>Accept and release payment</Button>
          <Button disabled={revisionsLeft < 1} onClick={() => setMode('revise')}>Request a revision</Button>
        </div>
      )}
      {mode === 'accept' && (
        <div className={styles.confirm}>
          <b>Release {inr(order.price)} to {order.expertName}?</b>
          <span className={styles.muted}>This pays the expert and cannot be undone.</span>
          <div className={styles.row}>
            <Button variant="sm" onClick={() => setMode('none')} disabled={busy}>Not yet</Button>
            <Button variant={['sm', 'primary']} disabled={busy} onClick={() => run(() => gigsApi.accept(order.id))}>{busy ? 'Releasing…' : 'Yes, release payment'}</Button>
          </div>
        </div>
      )}
      {mode === 'revise' && (
        <div className={styles.form}>
          <Field label="What should change?"><textarea rows={4} value={note} maxLength={L.deliveryNote} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className={styles.row}>
            <Button variant="sm" onClick={() => setMode('none')} disabled={busy}>Back</Button>
            <Button variant={['sm', 'primary']} disabled={busy || !note.trim()} onClick={() => run(() => gigsApi.requestRevision(order.id, note.trim()))}>Send request</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ReviewPanel({ order, onDone }: { order: GigOrder; onDone: (o?: GigOrder) => void }) {
  const { busy, fail, run } = useAction(onDone);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <Panel className={styles.form}>
      <h2 className={styles.h2}>Review this service</h2>
      <Field label="Rating">
        <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n === 1 ? '' : 's'}</option>)}
        </select>
      </Field>
      <Field label="Comment (optional)"><textarea rows={3} value={comment} maxLength={L.review} onChange={(e) => setComment(e.target.value)} /></Field>
      {fail && <p className={styles.error} role="alert">{fail}</p>}
      <div className={styles.row}>
        <Button variant="primary" disabled={busy} onClick={() => run(() => gigsApi.review(order.id, rating, comment.trim()))}>Post review</Button>
      </div>
    </Panel>
  );
}
