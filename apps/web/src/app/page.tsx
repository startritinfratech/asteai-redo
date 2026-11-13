import type { Metadata } from 'next';
import { shareMeta } from '@/features/marketing/shareMeta';
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
import { JsonLd } from '@/features/marketing/JsonLd';
import { organizationLd, websiteLd } from '@/features/marketing/structuredData';

const description =
  'AsteAI is a hiring and expert marketplace: AI interviews, server-scored role-fit assessments, verifiable Talent Passport certificates and escrow-protected projects.';

const title = 'ASTEAI — Hire and get hired on evidence';

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: '/' },
  ...shareMeta({ title, description, image: false }),
};

/** Public landing page. Static; only the account CTAs read the signed-in user on the client. */
export default function HomePage() {
  return (
    <div className={styles.page}>
      <JsonLd data={organizationLd()} />
      <JsonLd data={websiteLd()} />
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
