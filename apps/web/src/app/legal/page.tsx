import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import { LEGAL_DOCS } from '@/features/marketing/legal/documents';
import marketing from '@/features/marketing/marketing.module.css';
import page from '@/features/marketing/pages.module.css';

export const metadata: Metadata = {
  title: 'Legal',
  description: 'ASTEAI’s terms, privacy policy, cookie, refund and cancellation policies, and business agreements.',
  alternates: { canonical: '/legal' },
};

export default function LegalIndexPage() {
  return (
    <PageShell>
      <PageHero eyebrow="Legal" title="Legal documents">
        The policies and agreements that apply to ASTEAI, operated by Startrit Infratech Pvt. Ltd.
      </PageHero>
      <section className={page.block} aria-label="Documents">
        <div className={marketing.container}>
          <ul className={marketing.gridAuto}>
            {LEGAL_DOCS.map((d) => (
              <li key={d.slug} className={`${marketing.card} ${page.docCard}`}>
                <h2 className={page.docTitle}>
                  <Link href={`/legal/${d.slug}`} className={page.docLink}>{d.title}</Link>
                </h2>
                <p className={marketing.cardText}>{d.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </PageShell>
  );
}
