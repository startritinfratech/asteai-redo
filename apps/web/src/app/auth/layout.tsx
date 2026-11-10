import Link from 'next/link';
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
