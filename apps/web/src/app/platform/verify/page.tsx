'use client';

import { useState } from 'react';
import type { Passport } from '@asteai/types';
import { api, errorMessage } from '@/lib/api';
import { Button, CertCard, Field, Hash, KPI, PageHeader, Panel, Tag } from '@/components/ui';

/** GET /passports/verify?hash= → the passport only when it is valid. */
type VerifyResponse =
  | { valid: true; passport: Passport & { holderName?: string } }
  | { valid: false; message: string };

type Outcome =
  | { kind: 'valid'; passport: Passport & { holderName?: string } }
  | { kind: 'revoked' | 'expired' | 'notFound' | 'invalid'; message: string };

function classify(res: VerifyResponse): Outcome {
  if (res.valid) return { kind: 'valid', passport: res.passport };
  const msg = res.message || 'Passport could not be verified';
  const lower = msg.toLowerCase();
  if (lower.includes('revoked')) return { kind: 'revoked', message: msg };
  if (lower.includes('expired')) return { kind: 'expired', message: msg };
  if (lower.includes('not found')) return { kind: 'notFound', message: msg };
  return { kind: 'invalid', message: msg };
}

const OUTCOME_LABEL: Record<Exclude<Outcome['kind'], 'valid'>, string> = {
  revoked: 'Revoked',
  expired: 'Expired',
  notFound: 'Not found',
  invalid: 'Not valid',
};

const fmt = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '—');

export default function VerifyPage() {
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const hash = query.trim();
    if (!hash) return;
    setBusy(true);
    setError(null);
    setOutcome(null);

    try {
      const res = await api.get<VerifyResponse>('/passports/verify', { hash });
      setOutcome(classify(res));
    } catch (err) {
      setError(errorMessage(err, 'The passport could not be verified. Check the hash and try again.'));
    } finally {
      setBusy(false);
    }
  }

  const passport = outcome?.kind === 'valid' ? outcome.passport : null;
  const scores = Array.isArray(passport?.scores) ? passport.scores : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Account & Trust"
        title="Verify a Talent Passport"
        sub="Check a Talent Passport's verification hash against the AsteAI registry."
      />

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <form onSubmit={handleVerify} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <Field label="Passport verification hash">
              <input
                type="text"
                required
                placeholder="Paste the hash shown on the passport"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" variant="mint" disabled={busy || !query.trim()}>
            {busy ? 'Verifying…' : 'Verify'}
          </Button>
        </form>
        {error && <p role="alert" style={{ color: 'var(--rose)', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
      </Panel>

      {outcome && outcome.kind !== 'valid' && (
        <Panel>
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <Tag color={outcome.kind === 'expired' ? 'amber' : 'rose'}>{OUTCOME_LABEL[outcome.kind]}</Tag>
            <span style={{ fontSize: '0.9rem', color: 'var(--fg-2)' }}>
              {outcome.message}. This passport is not currently valid.
            </span>
          </div>
        </Panel>
      )}

      {passport && (
        <CertCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--fg-3)', textTransform: 'uppercase' }}>AsteAI Talent Passport</div>
              <h2 style={{ margin: '4px 0 0', fontSize: '1.4rem' }}>{passport.holderName ?? passport.name}</h2>
              <div style={{ fontSize: '0.85rem', color: 'var(--fg-2)' }}>
                {passport.holderName && <>{passport.name} · </>}Tier: <b>{passport.tier}</b> · Status: <Tag color="mint">{passport.status}</Tag>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Tag color="mint">✓ Verified</Tag>
              <div style={{ fontSize: '0.75rem', color: 'var(--fg-3)', marginTop: '4px' }}>
                <Hash>{passport.hash}</Hash>
              </div>
              {passport.validUntil > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--fg-3)', marginTop: '4px' }}>
                  Valid until {new Date(passport.validUntil).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', margin: '16px 0' }}>
            <KPI value={fmt(passport.sten?.iq)} label="IQ Reasoning Sten" />
            <KPI value={fmt(passport.sten?.eq)} label="EQ Collaborative Sten" />
            <KPI value={fmt(passport.sten?.grit)} label="Persistence (Grit)" />
            <KPI value={typeof passport.percentile === 'number' ? `${passport.percentile}th` : '—'} label="Percentile" />
          </div>

          {scores.length > 0 && (
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--fg-2)' }}>Skill scores</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {scores.map(([skill, score], i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-2)', borderRadius: '4px', fontSize: '0.85rem' }}>
                    <span>{skill}</span>
                    <span style={{ fontWeight: 600, color: 'var(--mint)' }}>{score}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CertCard>
      )}
    </div>
  );
}
