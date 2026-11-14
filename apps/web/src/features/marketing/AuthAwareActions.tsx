'use client';

/**
 * The only auth-aware bits of the public pages. Before the persisted user is read they
 * render the signed-out state, so server and first client render always match.
 */
import Link from 'next/link';
import { clsx } from 'clsx';
import { LOGIN_PATH, ROLE_HOME } from '@/lib/routes';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import styles from './marketing.module.css';

export const REGISTER_PATH = '/auth/register';

function useDashboardHref(): string | null {
  const hydrated = useAuthHydrated();
  const user = useAuthStore((s) => s.user);
  return hydrated && user ? ROLE_HOME[user.role] : null;
}

/** Header: "Sign in" + "Get started", or "Go to dashboard" when signed in. */
export function HeaderActions() {
  const dashboard = useDashboardHref();
  if (dashboard) {
    return (
      <Link href={dashboard} className={clsx(styles.btn, styles.btnPrimary, styles.btnSm)}>
        Go to dashboard
      </Link>
    );
  }
  return (
    <>
      <Link href={LOGIN_PATH} className={clsx(styles.btn, styles.btnGhost, styles.btnSm)}>
        Sign in
      </Link>
      <Link href={REGISTER_PATH} className={clsx(styles.btn, styles.btnPrimary, styles.btnSm)}>
        Get started
      </Link>
    </>
  );
}

/** A primary call to action that becomes "Go to dashboard" for signed-in visitors. */
export function PrimaryCta({ label, href = REGISTER_PATH }: { label: string; href?: string }) {
  const dashboard = useDashboardHref();
  return (
    <Link href={dashboard ?? href} className={clsx(styles.btn, styles.btnPrimary)}>
      {dashboard ? 'Go to dashboard' : label}
    </Link>
  );
}

/** Where /pricing sends someone choosing Pro: the wallet's upgrade panel (via sign-up when signed out). */
export const PRO_UPGRADE_PATH = '/platform/wallet?upgrade=pro';

/** "Upgrade to Pro": straight to the wallet's checkout when signed in, else sign up first. */
export function ProPlanCta() {
  const signedIn = useDashboardHref() !== null;
  const href = signedIn ? PRO_UPGRADE_PATH : `${REGISTER_PATH}?next=${encodeURIComponent(PRO_UPGRADE_PATH)}`;
  return (
    <Link href={href} className={clsx(styles.btn, styles.btnPrimary)}>
      {signedIn ? 'Upgrade to Pro' : 'Start with Pro'}
    </Link>
  );
}
