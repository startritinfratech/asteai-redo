'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useAuthStore } from '@/store/auth';
import { api, ApiError, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';

interface TeamMember {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  title: string;
  account_status: string;
  created_at: string;
}

export default function TeamPage() {
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const { data: members, error, isLoading, mutate } = useSWR<TeamMember[]>(
    tenantId ? `/tenants/${encodeURIComponent(tenantId)}/team` : null,
    fetcher,
  );

  const [openInvite, setOpenInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  // The API only adds Employer accounts to a tenant team.
  const role = 'Employer' as const;
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    try {
      await api.post(`/tenants/${encodeURIComponent(tenantId)}/team`, {
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role,
        title: title.trim(),
      });
      setEmail('');
      setFirstName('');
      setLastName('');
      setTitle('');
      setOpenInvite(false);
      void mutate();
    } catch (err) {
      alert(
        err instanceof ApiError && err.status === 409
          ? 'That email already has an AsteAI account'
          : errorMessage(err, 'Failed to add team member'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Account"
        title="Team & Roles"
        sub="Control recruiter access, assign talent assessment review permissions, and invite hiring collaborators."
        actions={
          <Button variant="primary" onClick={() => setOpenInvite(true)}>
            + Invite Team Member
          </Button>
        }
      />

      {isLoading && <Empty message="Loading team roster…" />}
      {error && <Empty message="Could not load team members." />}

      {openInvite && (
        <Panel style={{ display: 'flex', flexDirection: 'column', gap: '14px', border: '1px solid var(--blue)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Invite Organization Member</h3>
          <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label htmlFor="team-first-name" style={{ fontSize: '0.75rem', color: 'var(--fg-3)', display: 'block', marginBottom: '4px' }}>First Name</label>
                <input
                  id="team-first-name"
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
                />
              </div>
              <div>
                <label htmlFor="team-last-name" style={{ fontSize: '0.75rem', color: 'var(--fg-3)', display: 'block', marginBottom: '4px' }}>Last Name</label>
                <input
                  id="team-last-name"
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label htmlFor="team-work-email" style={{ fontSize: '0.75rem', color: 'var(--fg-3)', display: 'block', marginBottom: '4px' }}>Work Email</label>
                <input
                  id="team-work-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
                />
              </div>
              <div>
                <label htmlFor="team-role-title" style={{ fontSize: '0.75rem', color: 'var(--fg-3)', display: 'block', marginBottom: '4px' }}>Role / Title</label>
                <input
                  id="team-role-title"
                  type="text"
                  placeholder="e.g. Senior Talent Partner"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--bg-1)', color: 'var(--fg-1)' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Button type="submit" variant="mint" disabled={busy}>Send Invitation</Button>
              <Button type="button" onClick={() => setOpenInvite(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
        {members?.map((m) => (
          <Panel key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{m.first_name} {m.last_name}</span>
              <Tag color="mint">{m.role}</Tag>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--fg-2)' }}>{m.email}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--fg-3)' }}>{m.title || 'Team Member'}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
              Status: <span style={{ color: 'var(--mint)' }}>Active</span> · Joined: {new Date(m.created_at).toLocaleDateString()}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

