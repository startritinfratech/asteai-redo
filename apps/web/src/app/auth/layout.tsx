import type { Metadata } from 'next';
import Link from 'next/link';

/** Sign-in, sign-up and recovery pages are useful to people, not to search results. */
export const metadata: Metadata = { robots: { index: false, follow: true } };
import { Logo } from '@/features/marketing/Logo';
import styles from './auth.module.css';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Logo />
        <Link href="/" className={styles.back}>
          ← Back to home
        </Link>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
