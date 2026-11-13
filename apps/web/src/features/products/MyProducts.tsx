'use client';

/** /platform/products: an expert's digital products, from draft to live. */
import { useState, type FormEvent } from 'react';
import useSWR from 'swr';
import {
  PRODUCT_LICENSES, PRODUCT_LIMITS as L, type MyProduct, type ProductInput, type ProductLicense, type ProductStatus,
} from '@asteai/types';
import { api, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, Field, PageHeader, Panel, Tag, type TagColor } from '@/components/ui';
import styles from '@/features/gigs/Gigs.module.css';

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: 'Draft', pending: 'In review', active: 'Live', paused: 'Paused', rejected: 'Changes needed',
};
export const PRODUCT_STATUS_COLOR: Record<ProductStatus, TagColor> = {
  draft: 'grey', pending: 'amber', active: 'mint', paused: 'grey', rejected: 'rose',
};
const LICENSE_LABEL: Record<ProductLicense, string> = { single_team: 'Single team', organisation: 'Whole organisation', open_source: 'Open source' };
export const rupees = (minor: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(minor / 100);

const EDITABLE: ProductStatus[] = ['draft', 'rejected', 'paused'];

export function MyProducts() {
  const { data, error, isLoading, mutate } = useSWR<MyProduct[]>('/products/mine', fetcher);
  const [editing, setEditing] = useState<MyProduct | 'new' | null>(null);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Marketplace"
        title="My products"
        sub="Sell ready-made models, codebases and kits. Submitted products are reviewed before they go live; editing a paused product sends it back for review."
        actions={!editing && <Button variant="primary" onClick={() => setEditing('new')}>New product</Button>}
      />
      {editing && (
        <ProductEditor product={editing === 'new' ? null : editing} onDone={() => { setEditing(null); void mutate(); }} onCancel={() => setEditing(null)} />
      )}
      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={errorMessage(error, 'Could not load your products.')} />}
      {data && data.length === 0 && !editing && <Empty message="No products yet." />}
      <div className={styles.stack}>
        {data?.map((p) => <ProductRow key={p.id} product={p} onEdit={() => setEditing(p)} onChanged={() => mutate()} />)}
      </div>
    </div>
  );
}

function ProductRow({ product: p, onEdit, onChanged }: { product: MyProduct; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const move = async (action: 'submit' | 'pause' | 'resume') => {
    setBusy(true);
    setFail(null);
    try {
      await api.post(`/products/${encodeURIComponent(p.id)}/${action}`);
      onChanged();
    } catch (err) {
      setFail(errorMessage(err, 'That didn’t work.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className={styles.stack}>
      <div className={styles.between}>
        <b>{p.title}</b>
        <Tag color={PRODUCT_STATUS_COLOR[p.status]}>{PRODUCT_STATUS_LABEL[p.status]}</Tag>
      </div>
      <span className={styles.muted}>{p.category} · {rupees(p.priceMinor)} · {LICENSE_LABEL[p.license]}</span>
      <p className={styles.cardText}>{p.summary}</p>
      {p.reviewNote && p.status === 'rejected' && <p className={styles.note}><b>Reviewer:</b> {p.reviewNote}</p>}
      {fail && <p className={styles.error} role="alert">{fail}</p>}
      <div className={styles.row}>
        {EDITABLE.includes(p.status) && <Button variant="sm" onClick={onEdit}>Edit</Button>}
        {(p.status === 'draft' || p.status === 'rejected') && <Button variant={['sm', 'primary']} disabled={busy} onClick={() => move('submit')}>Submit for review</Button>}
        {p.status === 'active' && <Button variant="sm" disabled={busy} onClick={() => move('pause')}>Pause</Button>}
        {p.status === 'paused' && <Button variant="sm" disabled={busy} onClick={() => move('resume')}>Resume</Button>}
      </div>
    </Panel>
  );
}

function ProductEditor({ product, onDone, onCancel }: { product: MyProduct | null; onDone: () => void; onCancel: () => void }) {
  const [v, setV] = useState({
    title: product?.title ?? '', summary: product?.summary ?? '', description: product?.description ?? '',
    category: product?.category ?? '', tags: product?.tags.join(', ') ?? '',
    price: product ? String(product.priceMinor / 100) : '', license: product?.license ?? 'single_team' as ProductLicense,
  });
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const set = (k: keyof typeof v, value: string) => setV((x) => ({ ...x, [k]: value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const price = Number(v.price);
    if (v.title.trim().length < 3) return setFail('Add a title (3+ characters).');
    if (!v.category.trim()) return setFail('Add a category.');
    if (!Number.isFinite(price) || price < 1) return setFail('Enter a price of at least ₹1.');
    const input: ProductInput = {
      title: v.title.trim(), summary: v.summary.trim(), description: v.description.trim(), category: v.category.trim(),
      tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, L.tags),
      priceMinor: Math.round(price * 100), license: v.license,
    };
    setBusy(true);
    setFail(null);
    try {
      if (product) await api.put(`/products/${encodeURIComponent(product.id)}`, input);
      else await api.post('/products', input);
      onDone();
    } catch (err) {
      setFail(errorMessage(err, 'Could not save the product.'));
      setBusy(false);
    }
  }

  return (
    <Panel>
      <form className={styles.form} onSubmit={save} noValidate>
        <Field label="Title"><input value={v.title} maxLength={L.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Summary (shown on the card; 20+ characters to submit)"><input value={v.summary} maxLength={L.summary} onChange={(e) => set('summary', e.target.value)} /></Field>
        <Field label="Description (80+ characters to submit)"><textarea rows={6} value={v.description} maxLength={L.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className={styles.formGrid}>
          <Field label="Category"><input value={v.category} maxLength={60} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Codebases" /></Field>
          <Field label="Price (INR)"><input type="number" min={1} inputMode="decimal" value={v.price} onChange={(e) => set('price', e.target.value)} /></Field>
          <Field label="Licence">
            <select value={v.license} onChange={(e) => set('license', e.target.value)}>
              {PRODUCT_LICENSES.map((l) => <option key={l} value={l}>{LICENSE_LABEL[l]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Tags (comma-separated)"><input value={v.tags} onChange={(e) => set('tags', e.target.value)} placeholder="nextjs, saas, auth" /></Field>
        {fail && <p className={styles.error} role="alert">{fail}</p>}
        <div className={styles.row}>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : product ? 'Save changes' : 'Create draft'}</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}
