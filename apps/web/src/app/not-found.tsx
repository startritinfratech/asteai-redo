import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

export default function NotFound() {
  return (
    <PageShell>
      <div className={`${marketing.container} ${s.centered}`}>
        <span className={s.bigCode}>404</span>
        <h1 className={marketing.h2} id="page-title">We couldn’t find that page</h1>
        <p className={s.muted}>The link may be old, or the page may have moved.</p>
        <div className={s.ctaRow}>
          <Link href="/" className={`${marketing.btn} ${marketing.btnPrimary}`}>Go home</Link>
          <Link href="/jobs" className={marketing.btn}>Open roles</Link>
          <Link href="/contact" className={marketing.btn}>Contact us</Link>
        </div>
      </div>
    </PageShell>
  );
}
