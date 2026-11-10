import { clsx } from 'clsx';
import type { ExpertProfile } from './types';
import styles from './profiles.module.css';

const COPY: Record<ExpertProfile['status'], { title: string; text: string; cls: string }> = {
  draft: {
    title: 'Draft — not listed yet',
    text: 'Fill in your profile and submit it for review. Approved profiles appear in the public expert directory.',
    cls: styles.bannerDraft,
  },
  pending: {
    title: 'Pending review',
    text: 'An admin is reviewing your profile. You can keep editing while you wait.',
    cls: styles.bannerPending,
  },
  approved: {
    title: 'Approved — listed in the expert directory',
    text: 'Buyers can find you. Changes you save are visible right away.',
    cls: styles.bannerApproved,
  },
  rework: {
    title: 'Changes requested',
    text: 'Update your profile as described below, then submit it again.',
    cls: styles.bannerRework,
  },
  rejected: {
    title: 'Not approved',
    text: 'Your profile was not approved. You can improve it and submit it again.',
    cls: styles.bannerRejected,
  },
};

export function StatusBanner({ profile }: { profile: ExpertProfile }) {
  const c = COPY[profile.status];
  const showNote = profile.adminNote && profile.status !== 'pending';
  return (
    <div className={clsx(styles.banner, c.cls)} role="status">
      <strong>{c.title}</strong>
      <p>{c.text}</p>
      {showNote && <p><b>Admin note:</b> {profile.adminNote}</p>}
    </div>
  );
}

export function CompletionMeter({ value }: { value: number }) {
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <span id="completion-label">Profile completeness</span>
        <b>{value}%</b>
      </div>
      <div
        role="progressbar"
        aria-labelledby="completion-label"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className={styles.meterTrack}
      >
        <div className={clsx(styles.meterFill, value >= 80 && styles.meterGood)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
