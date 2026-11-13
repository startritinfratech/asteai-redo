'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DISPUTE_LIMITS } from '@asteai/types';
import { errorMessage } from '@/lib/api';
import { Button, Field } from '@/components/ui';
import { disputesApi } from './api';
import { REASON_OPTIONS } from './terms';
import type { DisputeReasonCode } from './types';
import styles from './Disputes.module.css';

/** The "Raise a dispute" form for one funded milestone; goes to the new dispute on success. */
export function RaiseDisputeForm({
  contractId, milestoneId, milestoneTitle, maxAmount, currency, onCancel,
}: {
  contractId: string; milestoneId: string; milestoneTitle: string; maxAmount: number; currency: string; onCancel: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState<DisputeReasonCode>('quality');
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = amountText.trim() ? Number(amountText) : undefined;
  const amountOk = amount === undefined
    || (Number.isFinite(amount) && amount > 0 && amount <= maxAmount && Math.round(amount * 100) / 100 === amount);
  const valid = description.trim().length >= 10 && amountOk;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const d = await disputesApi.create({
        contractId, milestoneId, reasonCode: reason, description: description.trim(), amountInDispute: amount,
      });
      router.push(`/platform/disputes/${encodeURIComponent(d.id)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className={styles.confirm}>
      <p className={styles.muted}>
        Dispute milestone “{milestoneTitle}”. The contract is paused while a dispute is open; the other party has 72 hours
        to respond, then the AsteAI team reviews it.
      </p>
      <Field label="Reason">
        <select value={reason} onChange={(e) => setReason(e.target.value as DisputeReasonCode)}>
          {REASON_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="What went wrong (at least 10 characters)">
        <textarea rows={5} maxLength={DISPUTE_LIMITS.description} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={`Amount in dispute, up to ${maxAmount} ${currency} (optional)`}>
        <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
      </Field>
      {!amountOk && <p className={styles.error}>Enter an amount up to {maxAmount}, with at most 2 decimals.</p>}
      <div className={styles.actions}>
        <Button onClick={onCancel} disabled={busy}>Back</Button>
        <Button variant="rose" disabled={busy || !valid} onClick={() => void submit()}>
          {busy ? 'Raising…' : 'Raise dispute'}
        </Button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
