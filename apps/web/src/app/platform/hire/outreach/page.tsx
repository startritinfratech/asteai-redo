'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  OUTREACH_VARIABLES, type OutreachEmailCampaign, type OutreachVariable, type PoolBoard, type Requisition, type TalentPoolSummary,
} from '@asteai/types';
import { ApiError, errorMessage, fetcher } from '@/lib/api';
import { fetchAllRequisitions } from '@/lib/requisitions';
import { useAuthStore } from '@/store/auth';
import { Button, Dialog, Empty, PageHeader, Panel, Tag } from '@/components/ui';
import { HIRE_KEYS, hireApi, type CampaignMessage } from '@/features/hire/api';
import {
  campaignMinutes, deliveredPct, parseRecipients, renderPreview, unknownVariables, VARIABLE_HELP,
} from '@/features/hire/format';
import styles from '@/features/hire/Hire.module.css';

const STATUS_COLOR = { draft: 'grey', queued: 'gold', completed: 'mint', cancelled: 'rose' } as const;

const DEFAULT_BODY = `Hi {{firstName}},

I'm {{senderName}} from {{companyName}}. We're hiring a {{jobTitle}} and your background looks like a strong fit.

Would you be open to a short call this week?

Thanks,
{{senderName}}`;

/** Bulk outreach: compose a templated campaign, queue it at a safe rate, and track delivery. */
export default function OutreachPage() {
  const { data: campaigns, error, mutate } = useSWR<OutreachEmailCampaign[]>(HIRE_KEYS.campaigns, fetcher, {
    refreshInterval: (list) => (list?.some((c) => c.status === 'queued') ? 15_000 : 0),
  });
  const [viewing, setViewing] = useState<OutreachEmailCampaign | null>(null);

  return (
    <>
      <PageHeader eyebrow="Hire & ATS" title="Bulk outreach" sub="Templated emails to a pool or a list, sent at a steady rate with an unsubscribe link in every message." />
      <Composer onCreated={() => { void mutate(); }} />
      <Panel className={styles.stack}>
        <h2 className={styles.h2}>Campaigns</h2>
        {error ? <Empty message="Could not load campaigns." /> : !campaigns ? <Empty message="Loading…" /> : !campaigns.length ? <Empty message="No campaigns yet." /> : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Campaign</th><th>Status</th><th>Delivery</th><th /></tr></thead>
              <tbody>
                {campaigns.map((c) => <CampaignRow key={c.id} c={c} onChanged={() => { void mutate(); }} onView={() => setViewing(c)} />)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Dialog open={viewing !== null} onOpenChange={(o) => { if (!o) setViewing(null); }} title={viewing?.name ?? ''} size="lg">
        {viewing && <Messages campaignId={viewing.id} />}
      </Dialog>
    </>
  );
}

function CampaignRow({ c, onChanged, onView }: { c: OutreachEmailCampaign; onChanged: () => void; onView: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const d = c.delivery;
  const pct = (n: number) => (d && d.total ? `${(n / d.total) * 100}%` : '0%');

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try { await fn(); onChanged(); } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? errorMessage(err, 'Daily sending limit reached') : errorMessage(err, 'That did not work'));
    } finally { setBusy(false); }
  }

  return (
    <tr>
      <td>
        <strong>{c.name}</strong>
        <div className={styles.muted}>{c.recipientCount} recipients · {c.ratePerMinute}/min · {new Date(c.createdAt).toLocaleDateString()}</div>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </td>
      <td><Tag color={STATUS_COLOR[c.status]}>{c.status}</Tag></td>
      <td style={{ minWidth: 200 }}>
        {d ? (
          <div className={styles.stack} style={{ gap: 4 }}>
            <div className={styles.bar} role="img" aria-label={`${d.sent} sent, ${d.failed} failed, ${d.queued + d.sending} pending of ${d.total}`}>
              <span className={styles.barSent} style={{ width: pct(d.sent) }} />
              <span className={styles.barFailed} style={{ width: pct(d.failed) }} />
              <span className={styles.barSending} style={{ width: pct(d.sending) }} />
            </div>
            <span className={styles.legend}>
              <span>{d.sent} sent</span><span>{d.failed} failed</span><span>{d.queued + d.sending} pending</span>
              {d.skipped > 0 && <span>{d.skipped} unsubscribed</span>}<span>{deliveredPct(d)}% done</span>
            </span>
          </div>
        ) : <span className={styles.muted}>Not queued</span>}
      </td>
      <td>
        <span className={styles.row} style={{ justifyContent: 'flex-end' }}>
          {c.status === 'draft' && <Button variantSize="sm" variant="primary" disabled={busy} onClick={() => { void run(() => hireApi.queueCampaign(c.id)); }}>Send</Button>}
          {(c.status === 'draft' || c.status === 'queued') && <Button variantSize="sm" disabled={busy} onClick={() => { void run(() => hireApi.cancelCampaign(c.id)); }}>Cancel</Button>}
          {c.status !== 'draft' && <button type="button" className={styles.link} onClick={onView}>Recipients</button>}
        </span>
      </td>
    </tr>
  );
}

function Messages({ campaignId }: { campaignId: string }) {
  const { data, error } = useSWR<CampaignMessage[]>(HIRE_KEYS.messages(campaignId), fetcher, { refreshInterval: 15_000 });
  if (error) return <Empty message="Could not load recipients." />;
  if (!data) return <Empty message="Loading…" />;
  const color = { queued: 'grey', sending: 'gold', sent: 'mint', failed: 'rose', skipped: 'amber', cancelled: 'grey' } as const;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Recipient</th><th>Scheduled</th><th>Status</th></tr></thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.id}>
              <td>{m.name || m.email}<div className={styles.muted}>{m.email}</div></td>
              <td>{new Date(m.sentAt ?? m.scheduledFor).toLocaleString()}</td>
              <td><Tag color={color[m.delivery]}>{m.delivery}</Tag>{m.error && <div className={styles.error}>{m.error}</div>}{m.skipReason && <div className={styles.muted}>{m.skipReason}</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Composer({ onCreated }: { onCreated: () => void }) {
  const user = useAuthStore((s) => s.user);
  const { data: pools } = useSWR<TalentPoolSummary[]>(HIRE_KEYS.pools, fetcher);
  const { data: reqs } = useSWR<Requisition[]>('/requisitions?all', fetchAllRequisitions);

  const [name, setName] = useState('');
  const [audience, setAudience] = useState<'pool' | 'list'>('pool');
  const [poolId, setPoolId] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [list, setList] = useState('');
  const [reqId, setReqId] = useState('');
  const [subject, setSubject] = useState('{{companyName}} is hiring: {{jobTitle}}');
  const [body, setBody] = useState(DEFAULT_BODY);
  const [rate, setRate] = useState(60);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('pool');
    if (fromUrl) { setAudience('pool'); setPoolId(fromUrl); }
  }, []);
  useEffect(() => { if (!poolId && pools?.length) setPoolId(pools[0].id); }, [pools, poolId]);
  const { data: board } = useSWR<PoolBoard>(audience === 'pool' && poolId ? HIRE_KEYS.board(poolId) : null, fetcher);

  const parsed = parseRecipients(list);
  const poolCount = board ? board.columns.filter((c) => !columns.length || columns.includes(c.key)).reduce((s, c) => s + c.members.length, 0) : 0;
  const count = audience === 'pool' ? poolCount : parsed.recipients.length;
  const sample = audience === 'list' ? parsed.recipients[0] : board?.columns.flatMap((c) => c.members)[0];
  const sampleName = sample && 'fullName' in sample && sample.fullName ? sample.fullName : 'Priya Menon';
  const job = reqs?.find((r) => r.id === reqId);
  const vars: Record<OutreachVariable, string> = {
    firstName: sampleName.split(' ')[0], fullName: sampleName, companyName: 'your company',
    jobTitle: job?.title ?? '', senderName: [user?.firstName, user?.lastName].filter(Boolean).join(' '),
  };
  const unknown = [...new Set([...unknownVariables(subject), ...unknownVariables(body)])];
  const needsJob = !job && /\{\{\s*jobTitle\s*\}\}/.test(subject + body);
  const ready = name.trim().length >= 2 && count > 0 && !unknown.length && subject.trim() && body.trim().length >= 10;

  function insert(v: OutreachVariable) {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    if (!el) { setBody((b) => b + token); return; }
    const { selectionStart: s, selectionEnd: e } = el;
    setBody(body.slice(0, s) + token + body.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  }

  async function save(send: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const c = await hireApi.createCampaign({
        name: name.trim(), subjectTemplate: subject, bodyTemplate: body, ratePerMinute: rate, requisitionId: reqId || undefined,
        ...(audience === 'pool' ? { poolId, poolColumns: columns.length ? columns : undefined } : { recipients: parsed.recipients }),
      });
      if (send) await hireApi.queueCampaign(c.id);
      setMessage({ ok: true, text: send ? `Sending to ${c.recipientCount} people over about ${campaignMinutes(c.recipientCount, rate)} min.` : 'Saved as a draft.' });
      setName('');
      onCreated();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'Could not create the campaign') });
      onCreated();
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <Panel className={styles.stack}>
      <h2 className={styles.h2}>New campaign</h2>
      <div className={styles.composer}>
        <div className={styles.stack}>
          <div className={styles.form}>
            <div className={styles.field}><label htmlFor="oc-name">Name</label><input id="oc-name" className={styles.input} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
            <div className={styles.field}>
              <label htmlFor="oc-req">Job (fills {'{{jobTitle}}'})</label>
              <select id="oc-req" className={styles.select} value={reqId} onChange={(e) => setReqId(e.target.value)}>
                <option value="">None</option>
                {(reqs ?? []).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </div>
          </div>

          <div className={styles.row} role="group" aria-label="Recipients from">
            <Button variantSize="sm" variant={audience === 'pool' ? 'primary' : 'default'} onClick={() => setAudience('pool')}>From a pool</Button>
            <Button variantSize="sm" variant={audience === 'list' ? 'primary' : 'default'} onClick={() => setAudience('list')}>Paste a list</Button>
          </div>
          {audience === 'pool' ? (
            pools && !pools.length ? <p className={styles.muted}>No pools yet; paste a list instead.</p> : (
              <div className={styles.stack}>
                <select aria-label="Pool" className={styles.select} value={poolId} onChange={(e) => { setPoolId(e.target.value); setColumns([]); }}>
                  {(pools ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.memberCount})</option>)}
                </select>
                {board && (
                  <div className={styles.chips} role="group" aria-label="Only these columns">
                    {board.columns.map((c) => (
                      <label key={c.key} className={styles.row}>
                        <input type="checkbox" checked={columns.includes(c.key)}
                          onChange={(e) => setColumns((cs) => (e.target.checked ? [...cs, c.key] : cs.filter((x) => x !== c.key)))} />
                        <span className={styles.muted}>{c.label} ({c.members.length})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          ) : (
            <textarea className={styles.textarea} aria-label="Recipients" value={list} onChange={(e) => setList(e.target.value)}
              placeholder={'One per line:\nPriya Menon <priya@example.com>'} />
          )}
          <span className={styles.muted}>
            {count} recipients{audience === 'list' && parsed.invalid.length ? ` · ${parsed.invalid.length} lines without an email` : ''}
          </span>

          <div className={styles.field}><label htmlFor="oc-subject">Subject</label><input id="oc-subject" className={styles.input} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className={styles.field}>
            <label htmlFor="oc-body">Message</label>
            <div className={styles.chips}>
              {OUTREACH_VARIABLES.map((v) => (
                <button key={v} type="button" className={styles.chip} title={VARIABLE_HELP[v]} onClick={() => insert(v)}>{`{{${v}}}`}</button>
              ))}
            </div>
            <textarea id="oc-body" ref={bodyRef} className={styles.textarea} style={{ minHeight: 220 }} value={body} maxLength={10_000} onChange={(e) => setBody(e.target.value)} />
          </div>
          {unknown.length > 0 && <p className={styles.error}>Unknown variable{unknown.length > 1 ? 's' : ''}: {unknown.map((u) => `{{${u}}}`).join(', ')}</p>}
          {needsJob && <p className={styles.notice}>{'{{jobTitle}}'} is empty until you pick a job.</p>}

          <div className={styles.field}>
            <label htmlFor="oc-rate">Send rate: {rate} emails/minute</label>
            <input id="oc-rate" type="range" min={1} max={300} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
            <span className={styles.muted}>About {campaignMinutes(count, rate)} min for {count} recipients. Your company&apos;s daily sending limit applies.</span>
          </div>
        </div>

        <div className={styles.preview} aria-label="Preview">
          <span className={styles.muted}>Preview for {sampleName}</span>
          <span className={styles.previewSubject}>{renderPreview(subject, vars) || '(no subject)'}</span>
          <p className={styles.previewBody}>{renderPreview(body, vars)}</p>
          <p className={styles.muted}>Every email ends with an unsubscribe link for {vars.companyName === 'your company' ? 'your company' : vars.companyName}.</p>
        </div>
      </div>

      <div className={styles.row}>
        <Button variant="primary" disabled={!ready || busy} onClick={() => setConfirm(true)}>Send campaign</Button>
        <Button disabled={!ready || busy} onClick={() => { void save(false); }}>Save draft</Button>
      </div>
      {message && <p className={message.ok ? styles.ok : styles.error} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Send to ${count} people?`}
        size="sm"
        description={`Emails go out at ${rate} per minute, about ${campaignMinutes(count, rate)} minutes in all. People who unsubscribed from your company are skipped.`}
        footer={(
          <>
            <Button onClick={() => setConfirm(false)}>Back</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void save(true); }}>{busy ? 'Queuing…' : 'Send'}</Button>
          </>
        )}
      />
    </Panel>
  );
}
