'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { GIG_LIMITS, SERVICE_CATEGORIES, SERVICE_SORTS, type ServiceCard, type ServiceDetail, type ServicePackage, type ServicePage, type ServiceSort } from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button, Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';
import { gigsApi } from './api';
import { inr, TIER_LABEL } from './format';
import styles from './Gigs.module.css';

const SORT_LABEL: Record<ServiceSort, string> = {
  relevance: 'Best match', newest: 'Newest', price_asc: 'Price: low to high', price_desc: 'Price: high to low', rating: 'Top rated',
};

interface Filters { q: string; category: string; minPrice: string; maxPrice: string; sort: ServiceSort }
const EMPTY: Filters = { q: '', category: '', minPrice: '', maxPrice: '', sort: 'relevance' };

function queryString(f: Filters, page: number): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.category) p.set('category', f.category);
  if (f.minPrice) p.set('minPrice', f.minPrice);
  if (f.maxPrice) p.set('maxPrice', f.maxPrice);
  if (f.sort !== 'relevance') p.set('sort', f.sort);
  p.set('page', String(page));
  return p.toString();
}

/** /platform/services: the searchable catalogue of published services, with the order flow in a dialog. */
export function Catalogue() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, isLoading } = useSWR<ServicePage>(`/services?${queryString(filters, page)}`, fetcher, { keepPreviousData: true });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Talent Sourcing"
        title="Pre-Packaged Services"
        sub="Fixed-scope packages from approved experts. You pay into escrow and release the money when you accept the delivery."
      />

      <Panel>
        <form
          className={styles.filters}
          onSubmit={(e) => { e.preventDefault(); setFilters(draft); setPage(1); }}
        >
          <Field label="Search"><input value={draft.q} maxLength={100} onChange={(e) => set({ q: e.target.value })} placeholder="e.g. security audit" /></Field>
          <Field label="Category">
            <select value={draft.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">All categories</option>
              {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Min price (INR)"><input type="number" min={0} inputMode="numeric" value={draft.minPrice} onChange={(e) => set({ minPrice: e.target.value })} /></Field>
          <Field label="Max price (INR)"><input type="number" min={0} inputMode="numeric" value={draft.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} /></Field>
          <Field label="Sort by">
            <select value={draft.sort} onChange={(e) => set({ sort: e.target.value as ServiceSort })}>
              {SERVICE_SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
            </select>
          </Field>
          <div className={styles.row}>
            <Button type="submit" variant="primary">Search</Button>
            <Button onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setPage(1); }}>Clear</Button>
          </div>
        </form>
      </Panel>

      {isLoading && <Empty message="Loading services…" />}
      {error && <Empty message={errorMessage(error, 'Could not load services.')} />}
      {data && data.items.length === 0 && <Empty message="No services match. Try fewer filters." />}

      <div className={styles.grid}>
        {data?.items.map((s) => <ServiceCardView key={s.id} service={s} onOpen={() => setOpen(s.slug)} />)}
      </div>

      {pages > 1 && (
        <div className={styles.pager}>
          <Button variant="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</Button>
          <span className={styles.muted}>Page {page} of {pages}</span>
          <Button variant="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      )}

      {open && <ServiceDialog slug={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ServiceCardView({ service: s, onOpen }: { service: ServiceCard; onOpen: () => void }) {
  return (
    <Panel className={styles.card}>
      <div className={styles.between}>
        <span className={styles.cardTitle}>{s.title}</span>
        <Tag color="mint">from {inr(s.fromPrice)}</Tag>
      </div>
      <div className={styles.cardMeta}>
        {s.category} · from {s.fromDays} days · {s.reviewCount > 0 ? `★ ${s.rating.toFixed(1)} (${s.reviewCount})` : 'No reviews yet'}
      </div>
      <p className={styles.cardText}>{s.summary}</p>
      {s.tags.length > 0 && <div className={styles.tags}>{s.tags.slice(0, 4).map((t) => <Tag key={t} color="grey">{t}</Tag>)}</div>}
      <div className={styles.cardFoot}>
        <span className={styles.muted}>by <b>{s.expertName}</b></span>
        <Button variant="sm" onClick={onOpen}>View packages</Button>
      </div>
    </Panel>
  );
}

/** Package picker, then the order form, then a confirm step before anything is created. */
function ServiceDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { data: service, error, isLoading } = useSWR<ServiceDetail>(`/services/${encodeURIComponent(slug)}`, fetcher);
  const [picked, setPicked] = useState<ServicePackage | null>(null);
  const [step, setStep] = useState<'pick' | 'form' | 'confirm'>('pick');
  const [requirements, setRequirements] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canOrder = user?.role === 'Buyer' && service && !service.isOwner;
  const place = async () => {
    if (!picked) return;
    setBusy(true);
    setFail(null);
    try {
      const order = await gigsApi.order({ packageId: picked.id, requirements: requirements.trim(), acceptTerms: true });
      router.push(order.contractId ? `/platform/contracts/${encodeURIComponent(order.contractId)}` : `/platform/orders/${encodeURIComponent(order.id)}`);
    } catch (err) {
      setFail(errorMessage(err, 'Could not place the order.'));
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={service?.title ?? 'Service'} onClick={(e) => e.stopPropagation()}>
        <div className={styles.between}>
          <h2 className={styles.h2}>{service?.title ?? 'Service'}</h2>
          <Button variant="sm" onClick={onClose}>Close</Button>
        </div>
        {isLoading && <Empty message="Loading…" />}
        {error && <Empty message={errorMessage(error, 'Could not load this service.')} />}

        {service && (
          <>
            <div className={styles.cardMeta}>{service.category} · by {service.expertName}{service.reviewCount > 0 ? ` · ★ ${service.rating.toFixed(1)} (${service.reviewCount})` : ''}</div>
            {step === 'pick' && <p className={styles.note}>{service.description}</p>}

            {step === 'pick' && (
              <>
                <div className={styles.packages}>
                  {service.packages.map((p) => (
                    <div key={p.id} className={styles.pkg} data-selected={picked?.id === p.id}>
                      <Tag color="gold">{TIER_LABEL[p.tier]}</Tag>
                      <b>{p.name}</b>
                      <span className={styles.price}>{inr(p.price)}</span>
                      <span className={styles.muted}>{p.deliveryDays} day delivery · {p.revisions} revision{p.revisions === 1 ? '' : 's'}</span>
                      {p.description && <span className={styles.cardText}>{p.description}</span>}
                      {p.features.length > 0 && <ul className={styles.features}>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>}
                      <Button variant="sm" onClick={() => setPicked(p)}>{picked?.id === p.id ? 'Selected' : 'Select'}</Button>
                    </div>
                  ))}
                </div>
                {!canOrder && <p className={styles.notice}>{service.isOwner ? 'This is your own service.' : 'Only buyer accounts can order services.'}</p>}
                <div className={styles.row}>
                  <Button variant="primary" disabled={!picked || !canOrder} onClick={() => setStep('form')}>Continue</Button>
                </div>
              </>
            )}

            {step !== 'pick' && picked && (
              <div className={styles.form}>
                <p className={styles.note}>
                  {TIER_LABEL[picked.tier]} package &ldquo;{picked.name}&rdquo;: {inr(picked.price)}, delivered in {picked.deliveryDays} days, {picked.revisions} revision{picked.revisions === 1 ? '' : 's'} included.
                </p>
                {step === 'form' && (
                  <>
                    <Field label="What do you need? (requirements)">
                      <textarea rows={6} value={requirements} maxLength={GIG_LIMITS.requirements} onChange={(e) => setRequirements(e.target.value)} />
                    </Field>
                    <label className={styles.check}>
                      <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                      <span>I accept this package&apos;s terms: the price, delivery time and revision count above, with payment held in escrow until I accept the delivery.</span>
                    </label>
                    <div className={styles.row}>
                      <Button onClick={() => setStep('pick')}>Back</Button>
                      <Button variant="primary" disabled={!agreed || requirements.trim().length < 10} onClick={() => setStep('confirm')}>Review order</Button>
                    </div>
                    {requirements.trim().length < 10 && <span className={styles.muted}>Describe what you need in at least 10 characters.</span>}
                  </>
                )}
                {step === 'confirm' && (
                  <div className={styles.confirm}>
                    <b>Place this order?</b>
                    <span className={styles.muted}>
                      Nothing is charged yet. You will be taken to the contract page to pay {inr(picked.price)} into escrow.
                    </span>
                    {fail && <p className={styles.error} role="alert">{fail}</p>}
                    <div className={styles.row}>
                      <Button onClick={() => setStep('form')} disabled={busy}>Back</Button>
                      <Button variant="primary" disabled={busy} onClick={place}>{busy ? 'Placing…' : `Place order for ${inr(picked.price)}`}</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
