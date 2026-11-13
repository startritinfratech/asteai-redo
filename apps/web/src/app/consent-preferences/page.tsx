import type { Metadata } from 'next';
import Link from 'next/link';
import { ToastProvider } from '@/components/ui';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';
import { ConsentForm } from './ConsentForm';

export const metadata: Metadata = {
  title: 'Consent Preferences',
  description: 'Choose which optional cookies ASTEAI may use on this browser.',
  alternates: { canonical: '/consent-preferences' },
};

export default function ConsentPreferencesPage() {
  return (
    <PageShell>
      <PageHero eyebrow="Privacy" title="Consent preferences">
        Choose which optional cookies we may use on this browser. You can change this at any time.
      </PageHero>
      <div className={`${marketing.container} ${s.listSection}`}>
        <div style={{ maxWidth: 760 }}>
          <ToastProvider>
            <ConsentForm />
          </ToastProvider>
          <p className={s.muted} style={{ marginTop: 32 }}>
            These settings apply to this browser only. Account-level consents (for example, use of your assessment data)
            are managed under <Link href="/platform/privacy" className={marketing.textLink}>Privacy settings</Link>. Read
            the <Link href="/legal/cookies" className={marketing.textLink}>Cookie Policy</Link> for details.
          </p>
        </div>
      </div>
    </PageShell>
  );
}
