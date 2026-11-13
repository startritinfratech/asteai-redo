'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  GIG_LIMITS as L, PACKAGE_TIERS, SERVICE_CATEGORIES, type MyService, type PackageInput, type PackageTier,
} from '@asteai/types';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { Button, Empty, Field, PageHeader, Panel, Tag } from '@/components/ui';
import { TagInput } from '../profiles/TagInput';
import { gigsApi } from './api';
import { inr, SERVICE_STATUS_COLOR, SERVICE_STATUS_LABEL, TIER_LABEL } from './format';
import styles from './Gigs.module.css';

interface PkgDraft { on: boolean; name: string; description: string; price: string; deliveryDays: string; revisions: string; features: string }
type Drafts = Record<PackageTier, PkgDraft>;

const blankPkg = (tier: PackageTier): PkgDraft => ({
  on: tier === 'basic', name: TIER_LABEL[tier], description: '', price: '', deliveryDays: '7', revisions: '1', features: '',
});

function draftsOf(service: MyService | null): Drafts {
  const out = { basic: blankPkg('basic'), standard: blankPkg('standard'), premium: blankPkg('premium') } as Drafts;
  for (const p of service?.packages ?? []) {
    out[p.tier] = {
      on: true, name: p.name, description: p.description, price: String(p.price), deliveryDays: String(p.deliveryDays),
      revisions: String(p.revisions), features: p.features.join('\n'),
    };
  }
  return out;
}

/** The package inputs the form describes, or the first problem found. */
function toPackages(d: Drafts): { packages: PackageInput[] } | { problem: string } {
  const packages: PackageInput[] = [];
  for (const tier of PACKAGE_TIERS) {
    const p = d[tier];
    if (!p.on) continue;
    const price = Number(p.price);
    const days = Number(p.deliveryDays);
    const revisions = Number(p.revisions);
    if (!p.name.trim()) return { problem: `${TIER_LABEL[tier]}: add a name` };
    if (!(price > 0)) return { problem: `${TIER_LABEL[tier]}: the price must be above zero` };
    if (!Number.isInteger(days) || days < 1 || days > 180) return { problem: `${TIER_LABEL[tier]}: delivery is 1 to 180 days` };
    if (!Number.isInteger(revisions) || revisions < 0 || revisions > 10) return { problem: `${TIER_LABEL[tier]}: revisions are 0 to 10` };
    packages.push({
      tier, name: p.name.trim(), description: p.description.trim(), price, deliveryDays: days, revisions,
      features: p.features.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, L.features),
    });
  }
  if (!packages.length) return { problem: 'Offer at least one package' };
  return { packages };
}

/** /platform/my-services: an expert's listings, the editor with packages, submit for review and pause. */
export function MyServices() {
  const hydrated = useAuthHydrated();
  const isExpert = useAuthStore((s) => s.user?.role === 'Freelancer');
  const { data, error, isLoading, mutate } = useSWR<MyService[]>(hydrated && isExpert ? '/services/mine' : null, fetcher);
  const [editing, setEditing] = useState<MyService | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);

  if (!hydrated) return <Empty message="Loading…" />;
  if (!isExpert) return <Empty message="Freelancer accounts only." />;

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusyId(id);
    setFail(null);
    try {
      await run();
      await mutate();
    } catch (err) {
      setFail(errorMessage(err, 'That did not work.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Marketplace"
        title="My services"
        sub="Pre-packaged services buyers can order. An admin reviews each one before it goes live; only experts with an approved profile can submit."
        actions={!editing && <Button variant="primary" onClick={() => setEditing('new')}>New service</Button>}
      />
      {fail && <p className={styles.error} role="alert">{fail}</p>}

      {editing && (
        <Editor
          key={editing === 'new' ? 'new' : editing.id}
          service={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await mutate(); }}
        />
      )}

      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={errorMessage(error, 'Could not load your services.')} />}
      {data && data.length === 0 && !editing && <Empty message="You have no services yet." />}

      <div className={styles.stack}>
        {data?.map((s) => (
          <Panel key={s.id} className={styles.stack}>
            <div className={styles.between}>
              <span className={styles.h2}>{s.title}</span>
              <Tag color={SERVICE_STATUS_COLOR[s.status]}>{SERVICE_STATUS_LABEL[s.status]}</Tag>
            </div>
            <span className={styles.muted}>
              {s.category} · {s.packages.length} package{s.packages.length === 1 ? '' : 's'}
              {s.packages.length > 0 && ` from ${inr(Math.min(...s.packages.map((p) => p.price)))}`}
              {s.reviewCount > 0 && ` · ★ ${s.rating.toFixed(1)} (${s.reviewCount})`}
            </span>
            {s.adminNote && (s.status === 'rejected' || s.status === 'published') && <p className={styles.note}>Reviewer note: {s.adminNote}</p>}
            {s.status === 'pending' && <p className={styles.notice}>Waiting for an admin to review it. It cannot be edited meanwhile.</p>}
            <div className={styles.row}>
              {['draft', 'rejected', 'paused'].includes(s.status) && <Button variant="sm" onClick={() => setEditing(s)}>Edit</Button>}
              {['draft', 'rejected'].includes(s.status) && (
                <Button variant="sm" disabled={busyId === s.id} onClick={() => act(s.id, () => gigsApi.submit(s.id))}>Submit for review</Button>
              )}
              {s.status === 'published' && <Button variant="sm" disabled={busyId === s.id} onClick={() => act(s.id, () => gigsApi.pause(s.id))}>Pause</Button>}
              {s.status === 'paused' && <Button variant="sm" disabled={busyId === s.id} onClick={() => act(s.id, () => gigsApi.resume(s.id))}>Resume</Button>}
            </div>
            {s.status === 'published' && <span className={styles.muted}>Pause a live service to edit it; editing returns it to draft and it needs approval again.</span>}
          </Panel>
        ))}
      </div>
    </div>
  );
}

function Editor({ service, onCancel, onSaved }: { service: MyService | null; onCancel: () => void; onSaved: () => void | Promise<void> }) {
  const [title, setTitle] = useState(service?.title ?? '');
  const [category, setCategory] = useState(service?.category ?? SERVICE_CATEGORIES[0]);
  const [summary, setSummary] = useState(service?.summary ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [tags, setTags] = useState<string[]>(service?.tags ?? []);
  const [pk, setPk] = useState<Drafts>(() => draftsOf(service));
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const patch = (tier: PackageTier, p: Partial<PkgDraft>) => setPk((d) => ({ ...d, [tier]: { ...d[tier], ...p } }));

  const save = async () => {
    const parsed = toPackages(pk);
    if ('problem' in parsed) { setFail(parsed.problem); return; }
    if (title.trim().length < 3) { setFail('Add a title of at least 3 characters'); return; }
    setBusy(true);
    setFail(null);
    try {
      const input = { title: title.trim(), category, summary: summary.trim(), description: description.trim(), tags };
      const saved = service ? await gigsApi.update(service.id, input) : await gigsApi.create(input);
      await gigsApi.setPackages(saved.id, parsed.packages);
      await onSaved();
    } catch (err) {
      setFail(errorMessage(err, 'Could not save the service.'));
      setBusy(false);
    }
  };

  return (
    <Panel className={styles.form}>
      <h2 className={styles.h2}>{service ? 'Edit service' : 'New service'}</h2>
      <Field label="Title"><input value={title} maxLength={L.title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Category">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label={`Summary (${summary.length}/${L.summary})`}>
        <textarea rows={2} value={summary} maxLength={L.summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label={`Description (${description.length}/${L.description})`}>
        <textarea rows={7} value={description} maxLength={L.description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Tags (up to 10)">
        <TagInput value={tags} onChange={setTags} max={L.tags} maxLength={L.tag} placeholder="Type a tag and press Enter" />
      </Field>

      <h3 className={styles.h2}>Packages</h3>
      {PACKAGE_TIERS.map((tier) => {
        const p = pk[tier];
        return (
          <div key={tier} className={styles.editorPkg}>
            <label className={styles.check}>
              <input type="checkbox" checked={p.on} onChange={(e) => patch(tier, { on: e.target.checked })} />
              <span>Offer the {TIER_LABEL[tier]} package</span>
            </label>
            {p.on && (
              <>
                <Field label={`${TIER_LABEL[tier]} name`}><input value={p.name} maxLength={L.packageName} onChange={(e) => patch(tier, { name: e.target.value })} /></Field>
                <Field label={`${TIER_LABEL[tier]} description`}><textarea rows={2} value={p.description} maxLength={L.packageDescription} onChange={(e) => patch(tier, { description: e.target.value })} /></Field>
                <div className={styles.formGrid}>
                  <Field label={`${TIER_LABEL[tier]} price (INR)`}><input type="number" min={1} step="0.01" inputMode="decimal" value={p.price} onChange={(e) => patch(tier, { price: e.target.value })} /></Field>
                  <Field label={`${TIER_LABEL[tier]} delivery (days)`}><input type="number" min={1} max={180} inputMode="numeric" value={p.deliveryDays} onChange={(e) => patch(tier, { deliveryDays: e.target.value })} /></Field>
                  <Field label={`${TIER_LABEL[tier]} revisions`}><input type="number" min={0} max={10} inputMode="numeric" value={p.revisions} onChange={(e) => patch(tier, { revisions: e.target.value })} /></Field>
                </div>
                <Field label={`${TIER_LABEL[tier]} features (one per line)`}><textarea rows={3} value={p.features} onChange={(e) => patch(tier, { features: e.target.value })} /></Field>
              </>
            )}
          </div>
        );
      })}

      {service && service.status !== 'draft' && <p className={styles.notice}>Saving returns this service to draft; submit it again for review.</p>}
      {fail && <p className={styles.error} role="alert">{fail}</p>}
      <div className={styles.row}>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Panel>
  );
}
