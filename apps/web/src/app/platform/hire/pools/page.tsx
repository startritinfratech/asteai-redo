'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import type { PoolBoard, PoolMember, TalentPoolSummary } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';
import { HIRE_KEYS, hireApi } from '@/features/hire/api';
import { dropNeighbours, parseRecipients } from '@/features/hire/format';
import styles from '@/features/hire/Hire.module.css';

type Msg = { ok: boolean; text: string } | null;

/** Talent CRM: sourcing pools on Kanban boards. */
export default function PoolsPage() {
  const { data: pools, error, mutate: mutatePools } = useSWR<TalentPoolSummary[]>(HIRE_KEYS.pools, fetcher);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<Msg>(null);

  useEffect(() => {
    if (!selected && pools?.length) setSelected(pools[0].id);
  }, [pools, selected]);

  async function create() {
    setMessage(null);
    try {
      const pool = await hireApi.createPool({ name: name.trim() });
      setName('');
      await mutatePools();
      setSelected(pool.id);
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'Could not create the pool') });
    }
  }

  return (
    <>
      <PageHeader eyebrow="Hire & ATS" title="Talent CRM pools" sub="Collect candidates and prospects, move them through your sourcing stages, then reach them with outreach." />
      <Panel className={styles.stack}>
        <div className={styles.between}>
          <div className={styles.row} role="tablist" aria-label="Pools">
            {error ? <span className={styles.error}>Could not load pools.</span> : !pools ? <span className={styles.muted}>Loading…</span> : pools.map((p) => (
              <Button key={p.id} variantSize="sm" variant={p.id === selected ? 'primary' : 'default'} onClick={() => setSelected(p.id)}>
                {p.name} · {p.memberCount}
              </Button>
            ))}
          </div>
          <form className={styles.row} onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) void create(); }}>
            <input className={styles.input} style={{ width: 200 }} aria-label="New pool name" placeholder="New pool name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={name.trim().length < 2}>Create pool</Button>
          </form>
        </div>
        {message && <p className={message.ok ? styles.ok : styles.error} role="alert">{message.text}</p>}
      </Panel>
      {selected ? <Board poolId={selected} onChanged={() => { void mutatePools(); }} /> : pools && !pools.length && <Empty message="Create your first pool to start sourcing." />}
    </>
  );
}

function Board({ poolId, onChanged }: { poolId: string; onChanged: () => void }) {
  const { data: board, error, mutate } = useSWR<PoolBoard>(HIRE_KEYS.board(poolId), fetcher);
  const [dragging, setDragging] = useState<PoolMember | null>(null);
  const [slot, setSlot] = useState<{ column: string; index: number } | null>(null);
  const [paste, setPaste] = useState('');
  const [message, setMessage] = useState<Msg>(null);

  async function move(m: PoolMember, column: string, index: number) {
    const target = board?.columns.find((c) => c.key === column);
    if (!target) return;
    const neighbours = dropNeighbours(target.members, index, m.id);
    setMessage(null);
    try {
      await hireApi.moveMember(poolId, m.id, { column, ...neighbours });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'Could not move the card') });
    }
    void mutate();
  }

  async function add() {
    const { recipients, invalid } = parseRecipients(paste);
    if (!recipients.length) {
      setMessage({ ok: false, text: invalid.length ? `No valid emails found (${invalid.length} lines skipped).` : 'Paste some emails first.' });
      return;
    }
    try {
      const res = await hireApi.addMembers(poolId, { members: recipients });
      setPaste('');
      setMessage({ ok: true, text: `Added ${res.added}${res.alreadyInPool ? `, ${res.alreadyInPool} already in the pool` : ''}${invalid.length + res.invalid.length ? `, ${invalid.length + res.invalid.length} invalid` : ''}.` });
      void mutate();
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, 'Could not add people') });
    }
  }

  if (error) return <Empty message="Could not load this pool." />;
  if (!board) return <Empty message="Loading…" />;

  return (
    <>
      <div className={styles.between}>
        <h2 className={styles.h2}>{board.pool.name}</h2>
        <Link href={`/platform/hire/outreach?pool=${encodeURIComponent(poolId)}`} className={styles.link}>Email this pool →</Link>
      </div>
      {message && <p className={message.ok ? styles.ok : styles.error} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

      <div className={styles.board}>
        {board.columns.map((col) => (
          <section
            key={col.key}
            aria-label={`${col.label}, ${col.members.length}`}
            className={dragging && slot?.column === col.key ? `${styles.lane} ${styles.laneDrop}` : styles.lane}
            onDragOver={(e) => { if (dragging) { e.preventDefault(); if (slot?.column !== col.key) setSlot({ column: col.key, index: col.members.length }); } }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && slot) void move(dragging, slot.column, slot.index);
              setDragging(null);
              setSlot(null);
            }}
          >
            <div className={styles.laneHead}><h3 className={styles.h3}>{col.label}</h3><span className={styles.muted}>{col.members.length}</span></div>
            {col.members.map((m, i) => (
              <div key={m.id}>
                <div className={dragging && slot?.column === col.key && slot.index === i ? `${styles.dropSlot} ${styles.dropSlotActive}` : styles.dropSlot} />
                <article
                  className={dragging?.id === m.id ? `${styles.card} ${styles.cardDragging}` : styles.card}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); setDragging(m); }}
                  onDragEnd={() => { setDragging(null); setSlot(null); }}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const box = e.currentTarget.getBoundingClientRect();
                    const index = e.clientY < box.top + box.height / 2 ? i : i + 1;
                    if (slot?.column !== col.key || slot.index !== index) setSlot({ column: col.key, index });
                  }}
                >
                  <span className={styles.cardTitle}>{m.fullName || m.email}</span>
                  {m.fullName && <span className={styles.muted}>{m.email}</span>}
                  <span className={styles.row}>
                    {m.userId && <Tag color="mint">On AsteAI</Tag>}
                    {m.tags.map((t) => <Tag key={t}>{t}</Tag>)}
                  </span>
                  <span className={styles.between}>
                    <select className={styles.miniSelect} aria-label={`Move ${m.fullName || m.email}`} value={col.key}
                      onChange={(e) => { const target = board.columns.find((c) => c.key === e.target.value); if (target) void move(m, target.key, target.members.length); }}>
                      {board.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <button type="button" className={styles.link} aria-label={`Remove ${m.email}`}
                      onClick={() => { void hireApi.removeMember(poolId, m.id).then(() => { void mutate(); onChanged(); }); }}>✕</button>
                  </span>
                </article>
              </div>
            ))}
            {dragging && slot?.column === col.key && slot.index === col.members.length && <div className={`${styles.dropSlot} ${styles.dropSlotActive}`} />}
          </section>
        ))}
      </div>

      <Panel className={styles.stack}>
        <h3 className={styles.h3}>Add people to “{board.columns[0]?.label}”</h3>
        <textarea className={styles.textarea} aria-label="Emails to add" value={paste} onChange={(e) => setPaste(e.target.value)}
          placeholder={'One per line:\nPriya Menon <priya@example.com>\nrahul@example.com'} />
        <div className={styles.between}>
          <span className={styles.muted}>{parseRecipients(paste).recipients.length} valid addresses · up to 500 at a time</span>
          <Button variant="primary" onClick={() => { void add(); }}>Add to pool</Button>
        </div>
      </Panel>
    </>
  );
}
