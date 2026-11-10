import type { Metadata } from 'next';
import {
  AiTools,
  Assessments,
  FinalCta,
  Hero,
  Journeys,
  Passport,
  SiteFooter,
  SiteHeader,
  Trust,
} from '@/features/marketing';
import styles from '@/features/marketing/marketing.module.css';

const description =
  'AsteAI is a hiring and expert marketplace: AI interviews, server-scored role-fit assessments, verifiable Talent Passport certificates and escrow-protected projects.';

export const metadata: Metadata = {
  title: 'AsteAI — Hire and get hired on evidence',
  description,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'AsteAI',
    title: 'AsteAI — Hire and get hired on evidence',
    description,
  },
  twitter: {
    card: 'summary',
    title: 'AsteAI — Hire and get hired on evidence',
    description,
  },
};

/** Public landing page. Static; only the account CTAs read the signed-in user on the client. */
export default function HomePage() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <main id="main">
        <Hero />
        <Journeys />
        <Assessments />
        <Passport />
        <AiTools />
        <Trust />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
