'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { MyProduct, ProductStatus } from '@asteai/types';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { Button, Chips, Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';
import styles from '@/features/gigs/Gigs.module.css';
import { PRODUCT_STATUS_COLOR, PRODUCT_STATUS_LABEL, rupees } from './MyProducts';

const SHOWN: ProductStatus[] = ['pending', 'active', 'paused', 'rejected'];

/** /platform/product-approvals: admins publish or reject submitted products. */
export function ProductApprovals() {
  const hydrated = useAuthHydrated();
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const [status, setStatus] = useState<ProductStatus>('pending');
  const { data, error, isLoading, mutate } = useSWR<MyProduct[]>(hydrated && isAdmin ? `/admin/products?status=${status}` : null, fetcher);
  if (!hydrated) return <Empty message="Loading…" />;
  if (!isAdmin) return <Empty message="Admins only." />;

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="Admin" title="Product approvals" sub="Approved products appear in the public catalogue. A rejection needs a note; the seller sees it." />
      <Chips label="Product status" value={status} onChange={setStatus} options={SHOWN.map((s) => ({ id: s, label: PRODUCT_STATUS_LABEL[s] }))} />
      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={errorMessage(error, 'Could not load the queue.')} />}
      {data && data.length === 0 && <Empty message="Nothing here." />}
      <div className={styles.stack}>
        {data?.map((p) => <Item key={p.id} p={p} onDone={() => mutate()} />)}
      </div>
    </div>
  );
}

function Item({ p, onDone }: { p: MyProduct; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const decide = async (status: 'active' | 'rejected') => {
    if (status === 'rejected' && note.trim().length < 5) return setFail('Add a note (5+ characters) for the seller.');
    setBusy(true);
    setFail(null);
    try {
      await api.patch(`/admin/products/${encodeURIComponent(p.id)}/status`, { status, note: note.trim() || undefined });
      onDone();
    } catch (err) {
      setFail(errorMessage(err, 'Could not save the decision.'));
      setBusy(false);
    }
  };
  return (
    <Panel className={styles.stack}>
      <div className={styles.between}>
        <b>{p.title}</b>
        <Tag color={PRODUCT_STATUS_COLOR[p.status]}>{PRODUCT_STATUS_LABEL[p.status]}</Tag>
      </div>
      <span className={styles.muted}>{p.sellerName} · {p.category} · {rupees(p.priceMinor)} · tags: {p.tags.join(', ') || '—'}</span>
      <p className={styles.cardText}>{p.summary}</p>
      <p className={styles.note} style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p>
      {p.status === 'pending' && (
        <>
          <Field label="Note to the seller (required to reject)"><textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
          {fail && <p className={styles.error} role="alert">{fail}</p>}
          <div className={styles.row}>
            <Button variant={['sm', 'mint']} disabled={busy} onClick={() => decide('active')}>Approve</Button>
            <Button variant={['sm', 'rose']} disabled={busy} onClick={() => decide('rejected')}>Reject</Button>
          </div>
        </>
      )}
    </Panel>
  );
}
