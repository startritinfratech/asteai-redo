import type { Metadata } from 'next';
import Link from 'next/link';
import { PrimaryCta } from '@/features/marketing/AuthAwareActions';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

export const metadata: Metadata = {
  title: 'Enterprise AI Talent Sourcing',
  description: 'Verified, AI-matched engagements from enterprise teams: post a project, receive proposals from vetted experts, and pay through milestone escrow.',
  alternates: { canonical: '/marketplace' },
};

const STEPS = [
  { title: 'Post a project', text: 'Describe the outcome, budget and milestones. AI helps turn a rough brief into a clear scope.' },
  { title: 'Review proposals', text: 'Vetted experts bid with an approach, timeline and price. Talent Passport results are shown alongside.' },
  { title: 'Fund milestones', text: 'Each milestone is paid into escrow before work starts, so both sides are protected.' },
  { title: 'Accept & release', text: 'Review each delivery, request revisions, and release payment only when you accept.' },
] as const;

/**
 * Public overview of the project marketplace. Open projects are listed to signed-in
 * users today (`GET /projects/open` is authenticated); the public listing is Phase 3.
 */
export default function MarketplacePage() {
  return (
    <PageShell>
      <PageHero eyebrow="Talent sourcing" title="Enterprise AI talent sourcing">
        Verified, AI-matched engagements from enterprise teams, with every milestone protected by escrow.
      </PageHero>
      <div className={marketing.container}>
        <div className={s.ctaRow} style={{ marginBottom: 48 }}>
          <PrimaryCta label="Browse open projects" href="/platform/market" />
          <Link href="/experts" className={marketing.btn}>Find experts</Link>
        </div>
        <section className={s.section} aria-labelledby="how-h">
          <h2 id="how-h" className={s.sectionTitle}>How engagements work</h2>
          <ol className={`${s.steps} ${s.grid}`} style={{ marginTop: 24 }}>
            {STEPS.map((st) => (
              <li key={st.title} className={s.stepItem}>
                <h3 className={s.stepTitle}>{st.title}</h3>
                <p className={s.stepText}>{st.text}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className={s.section} aria-labelledby="more-h">
          <div className={s.cta}>
            <h2 id="more-h" className={s.sectionTitle}>Prefer a fixed scope?</h2>
            <p className={s.muted}>Pre-packaged services have set deliverables, timelines and prices.</p>
            <div className={s.ctaRow}>
              <Link href="/services" className={`${marketing.btn} ${marketing.btnPrimary}`}>Browse services</Link>
              <Link href="/how-it-works" className={marketing.btn}>How it works</Link>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
