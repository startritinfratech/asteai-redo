'use client';

/**
 * /platform/support: a signed-in user's help-desk tickets. `?ticket=TKT-…` (from the
 * "support replied" email) opens that ticket directly.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import type { SupportCategory, SupportTicket, SupportTicketDetail, TicketStatus } from '@asteai/types';
import { api, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, Field, PageHeader, Panel, Tag, type TagColor } from '@/components/ui';
import styles from '@/features/gigs/Gigs.module.css';

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', pending_user: 'Awaiting your reply', resolved: 'Resolved' };
export const TICKET_STATUS_COLOR: Record<TicketStatus, TagColor> = { open: 'amber', pending_user: 'gold', resolved: 'mint' };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function HelpDesk() {
  const openParam = useSearchParams().get('ticket');
  const [selected, setSelected] = useState<string | null>(openParam);
  const [creating, setCreating] = useState(false);
  const { data, error, isLoading, mutate } = useSWR<SupportTicket[]>('/support/tickets', fetcher);

  useEffect(() => { if (openParam) setSelected(openParam); }, [openParam]);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Account"
        title="Help & support"
        sub="Ask the ASTEAI team anything. We reply by email and here, usually within one business day."
        actions={!creating && <Button variant="primary" onClick={() => { setCreating(true); setSelected(null); }}>New ticket</Button>}
      />
      {creating && <NewTicket onCancel={() => setCreating(false)} onCreated={(t) => { setCreating(false); setSelected(t.id); void mutate(); }} />}
      {selected && <TicketThread id={selected} onChanged={() => mutate()} onClose={() => setSelected(null)} />}
      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={errorMessage(error, 'Could not load your tickets.')} />}
      {data && data.length === 0 && !creating && <Empty message="No tickets yet. Open one if something isn’t working." />}
      <div className={styles.stack}>
        {data?.map((t) => (
          <Panel key={t.id} className={styles.stack}>
            <div className={styles.between}>
              <b>{t.subject}</b>
              <Tag color={TICKET_STATUS_COLOR[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Tag>
            </div>
            <div className={styles.between}>
              <span className={styles.muted}>{t.id} · updated {when(t.updatedAt)}</span>
              <Button variant="sm" onClick={() => { setSelected(t.id); setCreating(false); }}>Open</Button>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function NewTicket({ onCancel, onCreated }: { onCancel: () => void; onCreated: (t: SupportTicketDetail) => void }) {
  const { data: categories } = useSWR<SupportCategory[]>('/support/categories', fetcher);
  const [categoryId, setCategoryId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!categoryId) return setFail('Choose a category.');
    if (subject.trim().length < 3) return setFail('Add a subject (3+ characters).');
    if (body.trim().length < 10) return setFail('Describe the problem (10+ characters).');
    setBusy(true);
    setFail(null);
    try {
      onCreated(await api.post<SupportTicketDetail>('/support/tickets', { categoryId, subject: subject.trim(), body: body.trim() }));
    } catch (err) {
      setFail(errorMessage(err, 'Could not open the ticket.'));
      setBusy(false);
    }
  }

  return (
    <Panel>
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="Category">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose…</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Subject"><input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="What happened?"><textarea rows={5} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} /></Field>
        {fail && <p className={styles.error} role="alert">{fail}</p>}
        <div className={styles.row}>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Sending…' : 'Open ticket'}</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}

/** One ticket with its conversation. `staff` switches to the admin endpoints. */
export function TicketThread({ id, staff = false, onChanged, onClose }: {
  id: string; staff?: boolean; onChanged: () => void; onClose: () => void;
}) {
  const base = staff ? `/admin/support/tickets/${encodeURIComponent(id)}` : `/support/tickets/${encodeURIComponent(id)}`;
  const { data, error, mutate } = useSWR<SupportTicketDetail>(base, fetcher);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFail(null);
    try {
      await fn();
      await mutate();
      onChanged();
    } catch (err) {
      setFail(errorMessage(err, 'That didn’t work. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Panel><p className={styles.error} role="alert">{errorMessage(error, 'Ticket not found.')}</p><Button onClick={onClose}>Close</Button></Panel>;
  if (!data) return <Empty message="Loading ticket…" />;

  return (
    <Panel className={styles.stack}>
      <div className={styles.between}>
        <b>{data.subject}</b>
        <Tag color={TICKET_STATUS_COLOR[data.status]}>{TICKET_STATUS_LABEL[data.status]}</Tag>
      </div>
      <span className={styles.muted}>{data.id} · opened {when(data.createdAt)}</span>
      <ol className={styles.stack} style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Conversation">
        {data.messages.map((m) => (
          <li key={m.id} className={styles.note}>
            <b>{m.fromStaff ? (staff ? 'Support (you or a teammate)' : 'ASTEAI Support') : m.authorName}</b>
            <span className={styles.muted}> · {when(m.createdAt)}</span>
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.body}</p>
          </li>
        ))}
      </ol>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!reply.trim()) return;
          void act(async () => { await api.post(`${base}/messages`, { body: reply.trim() }); setReply(''); });
        }}
      >
        <Field label={staff ? 'Reply to the user (they are emailed)' : 'Add a reply'}>
          <textarea rows={3} value={reply} maxLength={5000} onChange={(e) => setReply(e.target.value)} />
        </Field>
        {fail && <p className={styles.error} role="alert">{fail}</p>}
        <div className={styles.row}>
          <Button type="submit" variant="primary" disabled={busy || !reply.trim()}>Send reply</Button>
          {!staff && data.status !== 'resolved' && (
            <Button disabled={busy} onClick={() => void act(() => api.post(`${base}/resolve`))}>Mark resolved</Button>
          )}
          {staff && data.status !== 'resolved' && (
            <Button disabled={busy} onClick={() => void act(() => api.patch(base, { status: 'resolved' }))}>Resolve</Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </div>
      </form>
    </Panel>
  );
}
