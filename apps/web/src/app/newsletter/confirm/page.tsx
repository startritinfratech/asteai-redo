import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConfirmNewsletter } from '@/features/public-forms/NewsletterLinks';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

export const metadata: Metadata = { title: 'Confirm your subscription', robots: { index: false, follow: false } };

export default function ConfirmNewsletterPage() {
  return (
    <PageShell>
      <PageHero eyebrow="Newsletter" title="Confirm your subscription" />
      <div className={`${marketing.container} ${s.listSection}`}>
        <div style={{ maxWidth: 620 }}>
          <Suspense><ConfirmNewsletter /></Suspense>
        </div>
      </div>
    </PageShell>
  );
}
