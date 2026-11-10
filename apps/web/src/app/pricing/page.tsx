import type { Metadata } from 'next';
import { clsx } from 'clsx';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import { PrimaryCta } from '@/features/marketing/AuthAwareActions';
import { Bullets } from '@/features/marketing/sections';
import marketing from '@/features/marketing/marketing.module.css';
import page from '@/features/marketing/pages.module.css';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'ASTEAI plans — Free, Pro and Enterprise — and the credits used for AI-powered features.',
  alternates: { canonical: '/pricing' },
};

// Plans, credit costs and FAQ as published on the production pricing page.
const PLANS = [
  {
    name: 'Free',
    price: '₹0',
    period: '',
    description: 'Perfect for getting started',
    popular: false,
    features: ['Browse Projects & Experts', 'Messaging & Reviews', 'Natural language search', 'Basic Profile'],
  },
  {
    name: 'Pro',
    price: '₹499',
    period: '/month',
    description: 'For professionals and growing teams',
    popular: true,
    features: ['Everything in Free', 'AI Expert Search', 'Voice Search', 'AI Resume Autofill', 'AI Gig Creation', 'Priority Proposal Ranking'],
  },
  {
    name: 'Enterprise',
    price: '₹1499',
    period: '/month',
    description: 'For large organizations',
    popular: false,
    features: ['Everything in Pro', 'AI Project Creation', 'Proposal Analytics', 'Featured Placement', 'AI Dispute Management', 'Dedicated Support'],
  },
] as const;

const CREDIT_INFO = [
  { title: 'Credits per Plan', points: ['Pro: 100 credits / month', 'Enterprise: 300 credits / month'] },
  { title: 'Earning Credits', points: ['Complete profile to 100% → referral bonus', 'Refer friends → both earn credits', 'Top up via Wallet → Top Up Credits'] },
  { title: 'Wallet Overview', points: ['View balance & transaction history', 'Wallet credits ≠ contract earnings', 'Credits auto-refunded if AI fails', 'Oldest credits spent first (FIFO)'] },
] as const;

const CREDIT_COSTS = [
  ['Expert auto fill', '15 credits'],
  ['Chat with AI to get experts', '15 credits'],
  ['AI search', '15 credits'],
  ['Voice searches', '3 credits'],
  ['Create Gig using AI', '15 credits'],
  ['Create Project using AI', '15 credits'],
  ['Semantic search of gigs', '6 credits'],
  ['Project recommendations for expert', '6 credits'],
  ['Sending a proposal', '3–12 credits'],
  ['Quick expert connect', '1 credit'],
  ['Sending a dispute', '3 credits'],
] as const;

const FAQS = [
  { q: 'Can I switch plans anytime?', a: 'Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately.' },
  { q: 'Is there a free trial?', a: 'The Free plan is always available with core features. Pro plans include a 14-day free trial.' },
  { q: 'What payment methods do you accept?', a: 'We accept all major credit cards, debit cards, and UPI.' },
] as const;

export default function PricingPage() {
  return (
    <PageShell>
      <PageHero eyebrow="Pricing" title="Simple, Transparent Pricing Plans">
        Choose the perfect plan for your needs. Start free and scale as you grow.
      </PageHero>

      <section className={page.block} aria-labelledby="plans-title">
        <div className={marketing.container}>
          <h2 id="plans-title" className={clsx(page.subhead, page.flush)}>Plans</h2>
          <ul className={page.plans}>
            {PLANS.map((plan) => (
              <li key={plan.name} className={clsx(page.plan, plan.popular && page.planPopular)}>
                <div className={page.planHead}>
                  <h3 className={page.planName}>{plan.name}</h3>
                  {plan.popular && <span className={page.tag}>Most Popular</span>}
                </div>
                <p className={page.planDesc}>{plan.description}</p>
                <p className={page.price}>
                  {plan.price}
                  {plan.period && <span className={page.pricePer}>{plan.period}</span>}
                </p>
                <Bullets items={plan.features} />
                <div className={page.planCta}>
                  <PrimaryCta label="Get Started" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={page.block} aria-labelledby="credits-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <span className={marketing.eyebrow}>Credits</span>
            <h2 id="credits-title" className={marketing.h2}>Credits Overview</h2>
            <p className={marketing.lede}>
              Credits are ASTEAI&apos;s in-platform currency for AI-powered features. <strong>1 Credit = ₹5.</strong> Buy
              credits in bulk for discounts of up to 30%.
            </p>
          </div>
          <ul className={marketing.grid3}>
            {CREDIT_INFO.map((c) => (
              <li key={c.title} className={marketing.card}>
                <h3 className={marketing.cardTitle}>{c.title}</h3>
                <Bullets items={c.points} />
              </li>
            ))}
          </ul>

          <h3 className={page.subhead}>Credit Cost Reference</h3>
          <ul className={page.costGrid}>
            {CREDIT_COSTS.map(([label, cost]) => (
              <li key={label} className={page.cost}>
                <span>{label}</span>
                <span className={page.costValue}>{cost}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={page.block} aria-labelledby="faq-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <h2 id="faq-title" className={marketing.h2}>Frequently Asked Questions</h2>
            <p className={marketing.lede}>Got questions? We&apos;ve got answers.</p>
          </div>
          <div className={page.faq}>
            {FAQS.map((f) => (
              <details key={f.q} className={page.faqItem}>
                <summary className={page.faqQ}>{f.q}</summary>
                <p className={page.faqA}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={marketing.section} aria-labelledby="ready-title">
        <div className={marketing.container}>
          <div className={marketing.final}>
            <h2 id="ready-title" className={marketing.h2}>Ready to get started?</h2>
            <p className={marketing.lede}>Join ASTEAI to uplift your freelancer career or find experts in any domain.</p>
            <div className={marketing.ctaRow}>
              <PrimaryCta label="Start Free Today" />
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
