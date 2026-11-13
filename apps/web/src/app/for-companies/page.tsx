import type { Metadata } from 'next';
import { shareMeta } from '@/features/marketing/shareMeta';
import Link from 'next/link';
import { Accordion } from '@/components/ui';
import { PrimaryCta, REGISTER_PATH } from '@/features/marketing/AuthAwareActions';
import { JsonLd } from '@/features/marketing/JsonLd';
import { breadcrumbLd, faqLd } from '@/features/marketing/structuredData';
import { RequirementCta } from '@/features/public-forms/RequirementDialog';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

const description =
  'Deploy pre-assessed talent with verifiable passports, multi-modal evaluation pipelines and a 48-hour shortlist SLA for enterprise hiring.';

export const metadata: Metadata = {
  title: { absolute: 'Hire with ASTEAI — Enterprise Talent Delivery Platform' },
  description,
  alternates: { canonical: '/for-companies' },
  ...shareMeta({ title: 'Hire with ASTEAI — Enterprise Talent Delivery Platform', description }),
};

const FEATURES = [
  { title: 'Faster hiring', text: 'Automated workflows and instant candidate evaluations from our multi-modal AI engine cut time-to-hire.' },
  { title: 'AI candidate matching', text: 'Multi-layered AI compares skills, assessment evidence and role requirements to find the right fit.' },
  { title: 'Global talent access', text: 'Source and hire across borders, with multi-language résumé parsing and vernacular voice interviews.' },
  { title: 'Dedicated support', text: 'A success manager embedded in your workflow, from requirements discovery to your first hire.' },
  { title: 'Compliance & security', text: 'Encryption in transit and at rest, GDPR and DPDP data protection, and an ISO/IEC 27001 ISMS.' },
  { title: 'Analytics dashboard', text: 'Funnel analytics, live pipelines, velocity tracking and fairness reports across every role and region.' },
] as const;

const WORKFLOW = [
  { title: 'Company registration', text: 'Create your verified enterprise profile and organisational branding.' },
  { title: 'Dedicated manager', text: 'Get a dedicated expert to guide your implementation strategy.' },
  { title: 'Requirements discovery', text: 'We map your existing ATS, roles and compliance needs to the platform.' },
  { title: 'Pipeline setup', text: 'Custom interview stages, code assessments and AI behavioural rubrics.' },
  { title: 'Launch campaign', text: 'Invite recruiters and publish your first automated hiring campaign.' },
] as const;

const FAQ = [
  {
    q: 'How long does implementation take?',
    a: 'Most enterprise workspaces are configured and launched within 2 to 4 weeks, depending on your custom workflows and integrations.',
  },
  {
    q: 'Is there a limit on AI screenings?',
    a: 'Enterprise plans include usage tiers sized for high-volume hiring. We agree a plan that fits your projected volume, without surprise overages.',
  },
  {
    q: 'What level of support is included?',
    a: 'Enterprise customers get a dedicated customer success manager, prioritised technical support with agreed SLAs, and quarterly business reviews.',
  },
] as const;

export default function ForCompaniesPage() {
  return (
    <PageShell>
      <JsonLd data={faqLd(FAQ)} />
      <JsonLd data={breadcrumbLd([{ name: 'For companies', path: '/for-companies' }])} />
      <PageHero eyebrow="ASTEAI for companies" title="Hire faster with AI-powered talent acquisition">
        {description}
      </PageHero>
      <div className={marketing.container}>
        <div className={s.ctaRow} style={{ marginBottom: 56 }}>
          <PrimaryCta label="Start enterprise setup" href={`${REGISTER_PATH}?role=Employer`} />
          <RequirementCta autoOpen className={marketing.btn} />
          <Link href="/contact?intent=demo" className={marketing.btn}>Book a demo</Link>
        </div>

        <section className={s.section} aria-labelledby="features-h">
          <h2 id="features-h" className={s.sectionTitle}>Engineered for scale</h2>
          <p className={s.sectionLede}>One governed system from requirement to verified shortlist, built for teams hiring across technical, professional and frontline roles.</p>
          <ul className={`${s.grid} ${s.grid3}`}>
            {FEATURES.map((f) => (
              <li key={f.title} className={s.card}>
                <h3 className={s.cardTitle}>{f.title}</h3>
                <p className={s.cardText}>{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={s.section} aria-labelledby="workflow-h">
          <h2 id="workflow-h" className={s.sectionTitle}>Live enterprise workflow</h2>
          <p className={s.sectionLede}>Five steps from sign-up to your first automated hiring campaign.</p>
          <ol className={`${s.steps} ${s.steps5}`}>
            {WORKFLOW.map((w) => (
              <li key={w.title} className={s.stepItem}>
                <h3 className={s.stepTitle}>{w.title}</h3>
                <p className={s.stepText}>{w.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={s.section} aria-labelledby="faq-h">
          <h2 id="faq-h" className={s.sectionTitle}>Frequently asked questions</h2>
          <div style={{ maxWidth: 820, marginTop: 24 }}>
            <Accordion items={FAQ} />
          </div>
        </section>

        <section className={s.section} aria-labelledby="cta-h">
          <div className={s.cta}>
            <h2 id="cta-h" className={s.sectionTitle}>Ready to hire on evidence?</h2>
            <p className={s.muted}>Set up your workspace in minutes, or talk to us about an enterprise rollout.</p>
            <div className={s.ctaRow}>
              <PrimaryCta label="Start enterprise setup" href={`${REGISTER_PATH}?role=Employer`} />
              <Link href="/pricing?audience=employer" className={marketing.btn}>See employer pricing</Link>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
