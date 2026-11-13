import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import page from '@/features/marketing/pages.module.css';

export const metadata: Metadata = {
  title: 'About us',
  description:
    'ASTEAI is an AI-powered hiring platform that helps organizations discover, evaluate, and collaborate with talent based on skills, potential, and fit.',
  alternates: { canonical: '/about' },
};

// Content as published on the production "About Us" page.
const DOMAINS = [
  'Artificial Intelligence',
  'Robotics',
  'Semiconductors',
  'Quantum Computing',
  'SpaceTech',
  'Biotech & Genomics',
  'Nanotechnology',
  'Blockchain & Web3',
  'Aerospace',
];

const OFFER = [
  { title: 'Expert Discovery', text: 'AI-driven search and recommendation to surface the right experts for your unique requirements.' },
  { title: 'Engagement Management', text: 'Scope, contract and manage specialist engagements in one place — with NDAs, milestones and escrow built in.' },
  { title: 'Secure Collaboration', text: 'Integrated messaging, contracts, milestones, and dispute tools to keep projects on track.' },
  { title: 'AI Tools', text: 'Voice search, AI-assisted profile completion, AI-generated gig and project drafts, proposal analytics, and more.' },
];

const VALUES = [
  { title: 'Excellence', text: 'We curate and verify experts to maintain high quality standards.' },
  { title: 'Transparency', text: 'Clear pricing, honest reviews, and open communication.' },
  { title: 'Innovation', text: 'Continuous investment in AI and automation to improve matching and collaboration.' },
  { title: 'Trust & Safety', text: 'Robust moderation, identity verification, and dispute resolution to protect both sides.' },
];

export default function AboutPage() {
  return (
    <PageShell>
      <PageHero eyebrow="Platform Overview" title="About Us">
        Welcome to ASTEAI — an AI-powered hiring platform built to connect the right people with the right
        opportunities. We help organizations discover, evaluate, and collaborate with talent based on skills,
        potential, and fit — not just job titles or keywords.
      </PageHero>
      <div className={marketing.container}>
        <ul className={page.chips} aria-label="Domains">
          {DOMAINS.map((d) => <li key={d} className={page.chip}>{d}</li>)}
        </ul>
      </div>

      <section className={page.block} aria-labelledby="mission-title">
        <div className={marketing.container}>
          <h2 id="mission-title" className={marketing.h2}>Our Mission</h2>
          <p className={page.prose}>
            To make enterprise AI talent sourcing and management predictable. We combine autonomous sourcing, verified
            skills assessment and governed engagement management in one system, so critical AI and technical work
            starts faster and is delivered with confidence.
          </p>
        </div>
      </section>

      <section className={page.block} aria-labelledby="offer-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <h2 id="offer-title" className={marketing.h2}>What We Offer</h2>
          </div>
          <ul className={marketing.grid2}>
            {OFFER.map((o) => (
              <li key={o.title} className={marketing.card}>
                <h3 className={marketing.cardTitle}>{o.title}</h3>
                <p className={marketing.cardText}>{o.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={page.block} aria-labelledby="values-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <h2 id="values-title" className={marketing.h2}>Our Values</h2>
          </div>
          <ul className={marketing.gridAuto}>
            {VALUES.map((v) => (
              <li key={v.title} className={marketing.card}>
                <h3 className={marketing.cardTitle}>{v.title}</h3>
                <p className={marketing.cardText}>{v.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={page.block} aria-labelledby="story-title">
        <div className={marketing.container}>
          <h2 id="story-title" className={marketing.h2}>Our Story</h2>
          <p className={page.prose}>
            ASTEAI was founded by a team of engineers and researchers who experienced firsthand how hard it is to find
            qualified deep-tech experts quickly. We built the platform we wished we had - one that combines human
            expertise with AI precision to solve real-world challenges faster.
          </p>
        </div>
      </section>

      <section className={marketing.section} aria-labelledby="contact-title">
        <div className={marketing.container}>
          <div className={marketing.final}>
            <h2 id="contact-title" className={marketing.h2}>Contact Us</h2>
            <p className={marketing.lede}>We&apos;d love to hear from you. Reach out anytime:</p>
            <p className={`${marketing.lede} ${page.gapTop}`}>
              Email: <span className={page.email}>supportasteai@startrit.com</span>
            </p>
            <address className={`${page.address} ${page.gapTop}`}>
              #1, 1st Main road, Aishwarya Nagar, Ayanambakkam, Chennai, TN, India - 600095
            </address>
            <div className={marketing.ctaRow}>
              <Link href="/contact" className={`${marketing.btn} ${marketing.btnPrimary}`}>Contact Us</Link>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
