import type { ReactNode } from 'react';
import { OAUTH_PROVIDERS, oauthStartUrl } from './oauth';
import styles from '../auth.module.css';

export { OAUTH_ERRORS, oauthStartUrl } from './oauth';

/**
 * Google / GitHub buttons above the email form on /auth/login and /auth/register.
 * `role` (sign-up only) is the role a new account gets; existing accounts keep theirs.
 */
export function OAuthButtons({ next, role, divider, note }: {
  next?: string | null;
  role?: string | null;
  divider: string;
  /** Shown under the buttons, e.g. the terms a provider sign-up accepts. */
  note?: ReactNode;
}) {
  return (
    <div className={styles.oauth}>
      {OAUTH_PROVIDERS.map((p) => (
        <a key={p.id} className={styles.oauthButton} href={oauthStartUrl(p.id, { next, role })}>
          {p.label}
        </a>
      ))}
      {note && <p className={styles.oauthNote}>{note}</p>}
      <p className={styles.divider}>{divider}</p>
    </div>
  );
}
