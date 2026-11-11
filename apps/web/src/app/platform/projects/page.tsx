'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import type { MilestoneStatus, Project, ProjectStage, Proposal } from '@asteai/types';
import { api, errorMessage, fetcher } from '@/lib/api';
import { Button, Empty, Eyebrow, KPI, Panel, Tag, type TagColor } from '@/components/ui';
import { CreateContractWizard } from '@/features/contracts';
import styles from './projects.module.css';

const STAGE_COLOR: Partial<Record<ProjectStage | MilestoneStatus, TagColor>> = {
  'Open for Bids': 'gold',
  Contracted: 'amber',
  'In Progress': 'default',
  Completed: 'mint',
  Disputed: 'rose',
  Released: 'mint',
  Funded: 'gold',
};

/** Same rule as the API (proposals.service AWARDABLE_STAGES). */
const AWARDABLE_STAGES: readonly ProjectStage[] = ['Open for Bids', 'Shortlisting'];

type ProjectWithContract = Project & { contractId?: string | null };

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const contractHref = (id: string) => `/platform/contracts/${encodeURIComponent(id)}`;

export default function ProjectsPage() {
  const { data, error, isLoading, mutate } = useSWR<ProjectWithContract[]>('/projects/mine', fetcher);
  const [wizardFor, setWizardFor] = useState<{ project: ProjectWithContract; proposal: Proposal } | null>(null);

  return (
    <div className={styles.page}>
      <Eyebrow>Buyer</Eyebrow>
      <h1>My Projects</h1>

      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={error.message} />}
      {data && data.length === 0 && <Empty message="No projects yet." />}

      {data?.map((p) => (
        <ProjectCard
          key={p.id}
          project={p}
          onAwarded={() => void mutate()}
          onCreateContract={(proposal) => setWizardFor({ project: p, proposal })}
        />
      ))}

      {wizardFor && (
        <ContractDialog onClose={() => setWizardFor(null)}>
          <CreateContractWizard
            proposalId={wizardFor.proposal.id}
            projectTitle={wizardFor.project.title}
            expertName={wizardFor.proposal.expertName ?? ''}
            suggestedTotal={wizardFor.proposal.price}
            defaultNdaRequired={wizardFor.project.ndaRequired}
            onCancel={() => setWizardFor(null)}
          />
        </ContractDialog>
      )}
    </div>
  );
}

function ProjectCard({
  project: p, onAwarded, onCreateContract,
}: {
  project: ProjectWithContract;
  onAwarded: () => void;
  onCreateContract: (proposal: Proposal) => void;
}) {
  const key = `/proposals/project/${encodeURIComponent(p.id)}`;
  const { data: proposals, error, mutate } = useSWR<Proposal[]>(key, fetcher);
  const [busy, setBusy] = useState<string | null>(null);
  const [awardError, setAwardError] = useState<string | null>(null);
  const awardable = AWARDABLE_STAGES.includes(p.stage);

  async function award(proposal: Proposal) {
    const ok = window.confirm(
      `Award "${p.title}" to ${proposal.expertName} for ${inr(proposal.price)}? `
      + 'All other proposals on this project will be rejected.',
    );
    if (!ok) return;
    setBusy(proposal.id);
    setAwardError(null);
    try {
      await api.patch(`/proposals/${encodeURIComponent(proposal.id)}/award`);
      await mutate();
      onAwarded();
      // Straight on to the contract for the awarded proposal.
      onCreateContract({ ...proposal, status: 'Awarded', contractId: null });
    } catch (err) {
      setAwardError(errorMessage(err, 'Could not award this proposal'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel className={styles.card}>
      <div className={styles.header}>
        <h3>{p.title}</h3>
        <Tag color={STAGE_COLOR[p.stage] ?? 'default'}>{p.stage}</Tag>
      </div>
      <p className={styles.desc}>{p.description}</p>

      {/* projects.milestones is the legacy plan; once there's a contract its milestones are the real ones. */}
      {!p.contractId && p.milestones.length > 0 && (
        <div className={styles.milestones}>
          <span className={styles.label}>Planned milestones</span>
          {p.milestones.map((m) => (
            <div key={m.id} className={styles.milestone}>
              <span>{m.name}</span>
              <span className={styles.mAmt}>{inr(m.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.proposals}>
        <span className={styles.label}>Proposals</span>
        {error && <span className={styles.muted}>Could not load proposals.</span>}
        {proposals && proposals.length === 0 && <span className={styles.muted}>No proposals yet.</span>}
        {proposals?.map((pr) => (
          <div key={pr.id} className={styles.proposal}>
            <div className={styles.proposalMain}>
              <span className={styles.proposalWho}>{pr.expertName}</span>
              <span className={styles.mAmt}>{inr(pr.price)} · {pr.days} days</span>
            </div>
            {pr.note && <p className={styles.proposalNote}>{pr.note}</p>}
            <div className={styles.proposalActions}>
              <Tag color={pr.status === 'Awarded' ? 'mint' : pr.status === 'Pending' ? 'amber' : 'grey'}>
                {pr.status}
              </Tag>
              {pr.status === 'Pending' && awardable && (
                <Button variant={['mint', 'sm']} disabled={busy !== null} onClick={() => void award(pr)}>
                  {busy === pr.id ? 'Awarding…' : 'Award'}
                </Button>
              )}
              {pr.status === 'Awarded' && (pr.contractId
                ? <Link className={styles.link} href={contractHref(pr.contractId)}>View contract</Link>

                : (
                  <Button variant={['primary', 'sm']} onClick={() => onCreateContract(pr)}>
                    Create contract
                  </Button>
                ))}
            </div>
          </div>
        ))}
        {awardError && <p className={styles.error}>{awardError}</p>}
      </div>

      <div className={styles.footer}>
        <KPI value={inr(p.budget)} label="Budget" />
        <KPI value={proposals?.length ?? '–'} label="Proposals" />
        {p.contractId && (
          <Link className={styles.link} href={contractHref(p.contractId)}>Open contract →</Link>
        )}
      </div>
    </Panel>
  );
}

/** A modal panel for the contract wizard. Escape or the backdrop closes it. */
function ContractDialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Create contract">
        {children}
      </div>
    </div>
  );
}
