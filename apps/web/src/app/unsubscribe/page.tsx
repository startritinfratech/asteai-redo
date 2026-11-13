import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Unsubscribe } from '@/features/public-forms/NewsletterLinks';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } };

export default function UnsubscribePage() {
  return (
    <PageShell>
      <PageHero eyebrow="Newsletter" title="Unsubscribe" />
      <div className={`${marketing.container} ${s.listSection}`}>
        <div style={{ maxWidth: 620 }}>
          <Suspense><Unsubscribe /></Suspense>
        </div>
      </div>
    </PageShell>
  );
}
