'use client';

import { useState } from 'react';
import { Button, Field, Tag } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { billingApi } from './api';
import { formatDate, parseAccountForm, type AccountForm } from './format';
import type { PayoutAccount, PayoutMethod } from './types';
import styles from './Billing.module.css';

const EMPTY: AccountForm = { method: 'bank', accountHolder: '', accountNumber: '', ifsc: '', upiId: '' };

/**
 * The expert's payout destination: the masked account on file, or the form to add or
 * replace it. The full details are never sent back to the browser.
 */
export function PayoutAccountForm({
  account, onSaved,
}: { account: PayoutAccount | null; onSaved: (account: PayoutAccount) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<AccountForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<AccountForm>) => setForm((f) => ({ ...f, ...patch }));

  function startEdit() {
    setForm({ ...EMPTY, method: account?.method ?? 'bank', accountHolder: account?.accountHolder ?? '' });
    setError(null);
    setEditing(true);
  }

  async function save() {
    const parsed = parseAccountForm(form);
    if (!parsed.input) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await billingApi.saveAccount(parsed.input);
      setEditing(false);
      setForm(EMPTY);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing && account) {
    return (
      <div className={styles.stack}>
        <div className={styles.account}>
          <div className={styles.between}>
            <strong>{account.method === 'bank' ? 'Bank account' : 'UPI'}</strong>
            <Tag color={account.verified ? 'mint' : 'grey'}>{account.verified ? 'Verified' : 'Not verified yet'}</Tag>
          </div>
          <span>{account.accountHolder}</span>
          <span className={styles.mono}>{account.masked}</span>
          <span className={styles.muted}>Updated {formatDate(account.updatedAt)}</span>
        </div>
        <p className={styles.muted}>
          An account is verified once a payout to it has been paid. Changing it resets verification.
        </p>
        <div className={styles.actions}>
          <Button onClick={startEdit}>Change payout account</Button>
        </div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className={styles.stack}>
        <p className={styles.muted}>Add the bank account or UPI id your payouts should go to.</p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={startEdit}>Add payout account</Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className={styles.stack}
      onSubmit={(e) => { e.preventDefault(); void save(); }}
      autoComplete="off"
    >
      <fieldset className={styles.methods}>
        <legend>Pay me by</legend>
        {(['bank', 'upi'] as PayoutMethod[]).map((m) => (
          <label key={m}>
            <input type="radio" name="payout-method" value={m} checked={form.method === m} onChange={() => set({ method: m })} />
            {m === 'bank' ? 'Bank transfer (NEFT/IMPS)' : 'UPI'}
          </label>
        ))}
      </fieldset>
      <Field label="Account holder name">
        <input value={form.accountHolder} maxLength={100} onChange={(e) => set({ accountHolder: e.target.value })} />
      </Field>
      {form.method === 'bank' ? (
        <div className={styles.grid2}>
          <Field label="Account number">
            <input
              inputMode="numeric"
              value={form.accountNumber}
              maxLength={24}
              onChange={(e) => set({ accountNumber: e.target.value })}
            />
          </Field>
          <Field label="IFSC">
            <input
              value={form.ifsc}
              maxLength={11}
              placeholder="HDFC0001234"
              onChange={(e) => set({ ifsc: e.target.value.toUpperCase() })}
            />
          </Field>
        </div>
      ) : (
        <Field label="UPI id">
          <input value={form.upiId} maxLength={100} placeholder="name@bank" onChange={(e) => set({ upiId: e.target.value })} />
        </Field>
      )}
      <p className={styles.muted}>
        Your details are stored encrypted. Only the last digits are shown here; the full details are revealed
        only to the admin making a payout.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button onClick={() => { setEditing(false); setError(null); }} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save payout account'}</Button>
      </div>
    </form>
  );
}
