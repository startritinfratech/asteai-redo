'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { api, errorMessage, fetcher } from '@/lib/api';
import { latestConsentByPurpose, type ConsentRecord } from '@/lib/consents';
import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';

export default function PrivacyPage() {
  const { data: consents, isLoading, mutate } = useSWR<ConsentRecord[]>('/users/me/consents', fetcher);
  const [busyPurpose, setBusyPurpose] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  async function handleToggle(purpose: string, currentStatus: string) {
    setBusyPurpose(purpose);
    try {
      const active = currentStatus !== 'Active';
      await api.post('/users/me/consents', { purpose, active });
      void mutate();
    } catch (err) {
      alert(errorMessage(err, 'Failed to update consent'));
    } finally {
      setBusyPurpose(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const exportJson = await api.post<Record<string, unknown>>('/users/me/export', {});
      const blob = new Blob([JSON.stringify(exportJson, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `asteai-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExported(true);
    } catch (err) {
      alert(errorMessage(err, 'Failed to export data'));
    } finally {
      setExporting(false);
    }
  }

  const latest = latestConsentByPurpose(consents);

  const defaultPurposes = [
    'AI Proctoring & Biometric Integrity',
    'Public Talent Passport Credential Verification',
    'Voice AI Audio Processing & Synthesis',
    'Automated Skills Recommendations & Job Matching',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Account"
        title="Privacy & Consent"
        sub="Control your data rights, biometric evaluation telemetry consents, and generate DPDP Act compliance data exports."
      />

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Data Processing Consents</h3>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-2)' }}>
          You retain full ownership of your psychometric data and talent recordings. You can revoke any permission at any time.
        </p>

        {isLoading && <Empty message="Loading privacy settings…" />}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {defaultPurposes.map((purpose) => {
            const record = latest.get(purpose);
            const isActive = record ? record.status === 'Active' : true;

            return (
              <div
                key={purpose}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  background: 'var(--bg-2)',
                  borderRadius: '6px',
                  border: '1px solid var(--line)',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{purpose}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--fg-3)', marginTop: '2px' }}>
                    Status: <Tag color={isActive ? 'mint' : 'grey'}>{isActive ? 'Authorized' : 'Revoked'}</Tag>
                  </div>
                </div>

                <Button
                  variant={isActive ? 'rose' : 'mint'}
                  variantSize="sm"
                  disabled={busyPurpose === purpose}
                  onClick={() => handleToggle(purpose, isActive ? 'Active' : 'Revoked')}
                >
                  {isActive ? 'Revoke Consent' : 'Grant Consent'}
                </Button>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Download Personal Data Archive</h3>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--fg-2)' }}>
          Download an exhaustive, machine-readable JSON archive of your account profile, applications, assessments, and cryptographic talent passport hashes.
        </p>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <Button variant="default" disabled={exporting} onClick={handleExport}>
            {exporting ? 'Generating JSON Bundle…' : 'Export My Data (.json)'}
          </Button>
          {exported && <span style={{ color: 'var(--mint)', fontSize: '0.85rem' }}>✓ Data archive exported successfully.</span>}
        </div>
      </Panel>
    </div>
  );
}

