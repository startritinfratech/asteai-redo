import Link from 'next/link';
import styles from './marketing.module.css';

/** The AsteAI wordmark, linking home. */
export function Logo() {
  return (
    <Link href="/" className={styles.logo} aria-label="AsteAI home">
      <span className={styles.mark} aria-hidden="true" />
      <span aria-hidden="true">ASTEAI</span>
    </Link>
  );
}
