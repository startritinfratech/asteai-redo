import type { Metadata } from 'next';
import Link from 'next/link';
import { PrimaryCta, REGISTER_PATH } from '@/features/marketing/AuthAwareActions';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

const description =
  'Prove your skills once with AI interviews and server-scored assessments, earn a verifiable Talent Passport, and get matched to roles and paid projects.';

export const metadata: Metadata = {
  title: 'For Candidates & Experts',
  description,
  alternates: { canonical: '/for-experts' },
};

const PATHS = [
  {
    title: 'Get hired',
    text: 'Apply to verified openings. Assessed candidates are prioritised for shortlists and fast-tracked to interviews.',
    cta: { href: `${REGISTER_PATH}?role=Candidate`, label: 'Join as a candidate' },
    more: { href: '/jobs', label: 'Browse open roles' },
  },
  {
    title: 'Work as an expert',
    text: 'Bid on enterprise projects or sell fixed-scope services. Every milestone is funded into escrow before you start.',
    cta: { href: `${REGISTER_PATH}?role=Freelancer`, label: 'Join as an expert' },
    more: { href: '/marketplace', label: 'See open projects' },
  },
] as const;

const BENEFITS = [
  { title: 'AI interviews', text: 'Practise and interview by voice, in your language, with a transparent scoring rubric.' },
  { title: 'Role-fit assessments', text: 'Scored on the server and reviewed for integrity, so results mean something to employers.' },
  { title: 'Talent Passport', text: 'Your verified results in one shareable credential that anyone can check online.' },
  { title: 'Track your progress', text: 'Applications, interviews, deadlines and outcomes in one dashboard.' },
] as const;

export default function ForExpertsPage() {
  return (
    <PageShell>
      <PageHero eyebrow="For candidates & experts" title="Show what you can do, not just what you claim">
        {description}
      </PageHero>
      <div className={marketing.container}>
        <section className={s.section} aria-label="Choose your path">
          <ul className={s.grid}>
            {PATHS.map((p) => (
              <li key={p.title} className={s.card}>
                <h2 className={s.cardTitle}>{p.title}</h2>
                <p className={s.cardText}>{p.text}</p>
                <div className={`${s.ctaRow} ${s.cardFoot}`}>
                  <PrimaryCta label={p.cta.label} href={p.cta.href} />
                  <Link href={p.more.href} className={marketing.textLink}>{p.more.label} →</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className={s.section} aria-labelledby="benefits-h">
          <h2 id="benefits-h" className={s.sectionTitle}>What you get</h2>
          <ul className={`${s.grid} ${s.grid3}`} style={{ marginTop: 24 }}>
            {BENEFITS.map((b) => (
              <li key={b.title} className={s.card}>
                <h3 className={s.cardTitle}>{b.title}</h3>
                <p className={s.cardText}>{b.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={s.section} aria-labelledby="cta-h">
          <div className={s.cta}>
            <h2 id="cta-h" className={s.sectionTitle}>Already have an account?</h2>
            <div className={s.ctaRow}>
              <Link href="/auth/login" className={`${marketing.btn} ${marketing.btnPrimary}`}>Sign in</Link>
              <Link href="/how-it-works" className={marketing.btn}>How it works</Link>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
