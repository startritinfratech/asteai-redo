'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { Button, Chips, Field, Panel } from '@/components/ui';
import { contractsApi } from './api';
import {
  draftSumMinor, ENGAGEMENT_MODEL_OPTIONS, formatMoney, type MilestoneDraft, milestonesError, parseTerms, splitEvenly,
  TERM_FIELDS, termsTotal, toMinor,
} from './terms';
import type { Contract, EngagementModel, PaymentTerms } from './types';
import styles from './Contracts.module.css';

export interface CreateContractWizardProps {
  /** The awarded proposal the contract is for. Only the project's buyer can create it. */
  proposalId: string;
  /** Shown in the header and review step. */
  projectTitle?: string;
  expertName?: string;
  /** Pre-fills a fixed-price total (e.g. the proposal's price). */
  suggestedTotal?: number;
  /** Pre-ticks the NDA toggle (e.g. the project's ndaRequired). */
  defaultNdaRequired?: boolean;
  /** Called with the new contract. Default: navigate to /platform/contracts/[id]. */
  onCreated?: (contract: Contract) => void;
  /** Shows a Cancel button that calls this (e.g. to close a modal). */
  onCancel?: () => void;
}

const STEPS = ['Terms', 'Milestones', 'NDA', 'Review'] as const;
const emptyMilestone = (): MilestoneDraft => ({ title: '', amount: '', dueDate: '' });

/**
 * Buyer-side wizard: engagement model and payment terms → milestones that sum to the
 * terms total → optional NDA → review and send to the expert for signature.
 */
export function CreateContractWizard({
  proposalId, projectTitle, expertName, suggestedTotal, defaultNdaRequired = false, onCreated, onCancel,
}: CreateContractWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [model, setModel] = useState<EngagementModel>('fixed');
  const [rawTerms, setRawTerms] = useState<Record<string, string>>(
    suggestedTotal && suggestedTotal > 0 ? { totalAmount: String(suggestedTotal) } : {},
  );
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([emptyMilestone()]);
  const [ndaRequired, setNdaRequired] = useState(defaultNdaRequired);
  const [ndaText, setNdaText] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseTerms(model, rawTerms), [model, rawTerms]);
  const total = parsed.terms ? termsTotal(model, parsed.terms) : 0;
  const sumMinor = draftSumMinor(milestones);
  const msError = milestonesError(milestones, total);
  const ndaError = ndaRequired && !ndaText.trim() ? 'Enter the NDA text the expert will sign' : null;
  const stepError = [parsed.error ?? (total > 0 ? null : 'The total must be positive'), msError, ndaError, null][step];

  function updateMilestone(i: number, patch: Partial<MilestoneDraft>) {
    setMilestones((list) => list.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  function next() {
    setError(stepError);
    if (!stepError) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function create() {
    if (!parsed.terms || msError || ndaError) return;
    setBusy(true);
    setError(null);
    try {
      const contract = await contractsApi.create({
        proposalId,
        engagementModel: model,
        paymentTerms: parsed.terms as unknown as PaymentTerms,
        milestones: milestones.map((m) => ({
          title: m.title.trim(),
          amount: Number(m.amount),
          ...(m.dueDate ? { dueDate: m.dueDate } : {}),
        })),
        ndaRequired,
        ...(ndaRequired ? { ndaText: ndaText.trim() } : {}),
      });
      if (onCreated) onCreated(contract);
      else router.push(`/platform/contracts/${encodeURIComponent(contract.id)}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the contract'));
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={styles.stack}>
      <div className={styles.stack}>
        <h2 className={styles.h2}>Create contract{projectTitle ? `: ${projectTitle}` : ''}</h2>
        {expertName && <p className={styles.muted}>With {expertName}</p>}
        <ol className={styles.steps} aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} className={`${styles.step} ${i === step ? styles.stepOn : ''}`} aria-current={i === step ? 'step' : undefined}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      </div>

      {step === 0 && (
        <div className={styles.stack}>
          <Chips label="Engagement model" options={ENGAGEMENT_MODEL_OPTIONS} value={model} onChange={(m) => setModel(m)} />
          <div className={styles.grid2}>
            {TERM_FIELDS[model].map((f) => (
              <Field key={`${model}-${f.key}`} label={f.label}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={f.integer ? 1 : 0.01}
                  value={rawTerms[f.key] ?? ''}
                  onChange={(e) => setRawTerms((t) => ({ ...t, [f.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          <p className={styles.sum}>Contract total: {parsed.terms ? formatMoney(total) : '—'}</p>
        </div>
      )}

      {step === 1 && (
        <div className={styles.stack}>
          <p className={styles.muted}>Split the work into milestones. Each is funded into escrow and released separately.</p>
          {milestones.map((m, i) => (
            <div key={i} className={styles.msRow}>
              <Field label={`Milestone ${i + 1}`}>
                <input value={m.title} maxLength={200} onChange={(e) => updateMilestone(i, { title: e.target.value })} />
              </Field>
              <Field label="Amount (INR)">
                <input
                  type="number" inputMode="decimal" min={0} step={0.01}
                  value={m.amount} onChange={(e) => updateMilestone(i, { amount: e.target.value })}
                />
              </Field>
              <Field label="Due date">
                <input type="date" value={m.dueDate} onChange={(e) => updateMilestone(i, { dueDate: e.target.value })} />
              </Field>
              <Button
                variant="sm"
                disabled={milestones.length === 1}
                onClick={() => setMilestones((list) => list.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <div className={styles.row}>
            <Button variant="sm" disabled={milestones.length >= 50} onClick={() => setMilestones((l) => [...l, emptyMilestone()])}>
              Add milestone
            </Button>
            <Button
              variant="sm"
              onClick={() => {
                const parts = splitEvenly(total, milestones.length);
                setMilestones((l) => l.map((m, i) => ({ ...m, amount: String(parts[i]) })));
              }}
            >
              Split total evenly
            </Button>
          </div>
          <p className={`${styles.sum} ${sumMinor === toMinor(total) ? styles.sumOk : styles.sumBad}`} aria-live="polite">
            {formatMoney(sumMinor / 100)} of {formatMoney(total)} allocated
          </p>
        </div>
      )}

      {step === 2 && (
        <div className={styles.stack}>
          <label className={styles.check}>
            <input type="checkbox" checked={ndaRequired} onChange={(e) => setNdaRequired(e.target.checked)} />
            <span>Require the expert to sign an NDA with this contract</span>
          </label>
          {ndaRequired && (
            <Field label="NDA text">
              <textarea rows={8} maxLength={20_000} value={ndaText} onChange={(e) => setNdaText(e.target.value)} />
            </Field>
          )}
        </div>
      )}

      {step === 3 && parsed.terms && (
        <div className={styles.stack}>
          <ul className={styles.review}>
            <li>Model: {ENGAGEMENT_MODEL_OPTIONS.find((o) => o.id === model)?.label}</li>
            <li>Total: {formatMoney(total)}</li>
            <li>{milestones.length} milestone{milestones.length === 1 ? '' : 's'}: {milestones.map((m) => `${m.title.trim()} (${formatMoney(Number(m.amount))})`).join(', ')}</li>
            <li>NDA: {ndaRequired ? 'required' : 'not required'}</li>
          </ul>
          <label className={styles.check}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              I confirm these terms. The contract goes to {expertName ?? 'the expert'} for signature; nothing is charged until
              I fund a milestone.
            </span>
          </label>
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.actions}>
        {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
        {step > 0 && <Button onClick={() => { setError(null); setStep((s) => s - 1); }} disabled={busy}>Back</Button>}
        {step < STEPS.length - 1
          ? <Button variant="primary" onClick={next}>Next</Button>
          : <Button variant="primary" onClick={create} disabled={busy || !confirmed}>{busy ? 'Creating…' : 'Create and send for signature'}</Button>}
      </div>
    </Panel>
  );
}
