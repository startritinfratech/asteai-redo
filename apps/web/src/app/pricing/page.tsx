import type { Metadata } from 'next';
import Link from 'next/link';
import { clsx } from 'clsx';
import type { CreditCost, Plan, PlanAudience, PublicCreditSettings } from '@asteai/types';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import { PrimaryCta, ProPlanCta, REGISTER_PATH } from '@/features/marketing/AuthAwareActions';
import { Bullets } from '@/features/marketing/sections';
import marketing from '@/features/marketing/marketing.module.css';
import page from '@/features/marketing/pages.module.css';
import s from '@/features/marketing/public.module.css';
import { ApiNotFound, ApiUnavailable, serverGet } from '@/lib/serverApi';
import { JsonLd } from '@/features/marketing/JsonLd';
import { faqLd } from '@/features/marketing/structuredData';

type SearchParams = Record<string, string | string[] | undefined>;
const audienceOf = (sp: SearchParams): PlanAudience => (sp.audience === 'employer' ? 'employer' : 'individual');

export function generateMetadata({ searchParams }: { searchParams: SearchParams }): Metadata {
  const employer = audienceOf(searchParams) === 'employer';
  return {
    title: { absolute: employer ? 'Employer Pricing — ASTEAI Hire' : 'Pricing & Delivery Plans | ASTEAI' },
    description: employer
      ? 'Plans for hiring teams: requisitions, AI interviews and assessments, talent pools and enterprise rollout.'
      : 'Transparent pricing with milestone escrow protection, plus the credits used for AI-powered features.',
    alternates: { canonical: employer ? '/pricing?audience=employer' : '/pricing' },
  };
}

/** Shown only if the API is unreachable, so the page never renders empty. Mirrors the 016 seed. */
const FALLBACK_PLANS: Plan[] = [
  { id: 'free', audience: 'individual', name: 'Free', tagline: 'Perfect for getting started', priceMinor: 0, currency: 'INR', interval: 'month', monthlyCredits: 0, highlighted: false,
    features: ['Browse Projects & Experts', 'Messaging & Reviews', 'Natural language search', 'Basic Profile'] },
  { id: 'pro', audience: 'individual', name: 'Pro', tagline: 'For professionals and growing teams', priceMinor: 49900, currency: 'INR', interval: 'month', monthlyCredits: 100, highlighted: true,
    features: ['Everything in Free', 'AI Expert Search', 'Voice Search', 'AI Resume Autofill', 'AI Gig Creation', 'Priority Proposal Ranking'] },
  { id: 'enterprise', audience: 'individual', name: 'Enterprise', tagline: 'For large organizations', priceMinor: 149900, currency: 'INR', interval: 'month', monthlyCredits: 300, highlighted: false,
    features: ['Everything in Pro', 'AI Project Creation', 'Proposal Analytics', 'Featured Placement', 'AI Dispute Management', 'Dedicated Support'] },
];

/** Mirrors the 016 credit_costs seed; used only if the API is unreachable. */
const FALLBACK_COSTS: CreditCost[] = [
  { feature: 'expert_autofill', label: 'Expert profile autofill', cost: 15, costMax: null },
  { feature: 'ai_expert_chat', label: 'Chat with AI to find experts', cost: 15, costMax: null },
  { feature: 'ai_search', label: 'AI search', cost: 15, costMax: null },
  { feature: 'voice_search', label: 'Voice search', cost: 3, costMax: null },
  { feature: 'ai_create_gig', label: 'Create a gig with AI', cost: 15, costMax: null },
  { feature: 'ai_create_project', label: 'Create a project with AI', cost: 15, costMax: null },
  { feature: 'semantic_gig_search', label: 'Semantic search of gigs', cost: 6, costMax: null },
  { feature: 'project_recs', label: 'Project recommendations', cost: 6, costMax: null },
  { feature: 'proposal', label: 'Sending a proposal', cost: 3, costMax: 12 },
  { feature: 'quick_connect', label: 'Quick expert connect', cost: 1, costMax: null },
  { feature: 'dispute', label: 'Opening a dispute', cost: 3, costMax: null },
];

/** The base rate shown on this page (Pro: 100 credits for 499 rupees, about 5 a credit). */
const RUPEES_PER_CREDIT = 5;

const FAQS = [
  { q: 'Can I switch plans anytime?', a: 'Yes. You can upgrade or downgrade at any time; changes take effect immediately.' },
  { q: 'Is there a free trial?', a: 'The Free plan is always available with core features.' },
  { q: 'What payment methods do you accept?', a: 'Major credit and debit cards, UPI and netbanking, through Razorpay.' },
  { q: 'Do unused credits roll over?', a: 'Monthly plan credits expire at the end of each billing month. Credits you buy as a top-up never expire. The oldest credits are always spent first.' },
  { q: 'Can I buy credits without a plan?', a: 'Yes. Top up any time from your wallet; bigger packs save up to 30%.' },
] as const;

function price(p: Plan): { amount: string; per: string } {
  if (p.priceMinor === null) return { amount: 'Custom', per: '' };
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: p.currency, maximumFractionDigits: 0 }).format(p.priceMinor / 100);
  return { amount, per: p.priceMinor === 0 ? '' : `/${p.interval}` };
}

const costLabel = (c: CreditCost) =>
  `${c.costMax ? `${c.cost}–${c.costMax}` : c.cost} credit${(c.costMax ?? c.cost) === 1 ? '' : 's'}`;
const costRupees = (c: CreditCost) =>
  c.costMax ? `₹${c.cost * RUPEES_PER_CREDIT}–₹${c.costMax * RUPEES_PER_CREDIT}` : `₹${c.cost * RUPEES_PER_CREDIT}`;

export default async function PricingPage({ searchParams }: { searchParams: SearchParams }) {
  const audience = audienceOf(searchParams);
  let plans: Plan[] | null = null;
  let credits: PublicCreditSettings | null = null;
  try {
    [plans, credits] = await Promise.all([
      serverGet<Plan[]>('/plans', { params: { audience }, revalidate: 300 }),
      serverGet<PublicCreditSettings>('/public-settings/credits', { revalidate: 300 }),
    ]);
  } catch (err) {
    if (!(err instanceof ApiUnavailable || err instanceof ApiNotFound)) throw err;
  }
  const shown = plans ?? (audience === 'individual' ? FALLBACK_PLANS : []);
  const costs = credits?.costs ?? FALLBACK_COSTS;
  const employer = audience === 'employer';

  return (
    <PageShell>
      <JsonLd data={faqLd(FAQS)} />
      <PageHero eyebrow="Pricing" title={employer ? 'Plans for hiring teams' : 'Simple, transparent pricing'}>
        {employer
          ? 'Start free with one requisition, then scale to AI interviews, assessments and enterprise rollout.'
          : 'Start free and scale as you grow. Every engagement is protected by milestone escrow.'}
      </PageHero>

      <section className={page.block} aria-labelledby="plans-title">
        <div className={marketing.container}>
          <nav aria-label="Pricing audience" style={{ marginBottom: 24 }}>
            <ul className={s.ctaRow} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              <li>
                <Link href="/pricing" className={clsx(marketing.btn, marketing.btnSm, !employer && marketing.btnPrimary)} aria-current={!employer ? 'page' : undefined}>
                  Experts &amp; buyers
                </Link>
              </li>
              <li>
                <Link href="/pricing?audience=employer" className={clsx(marketing.btn, marketing.btnSm, employer && marketing.btnPrimary)} aria-current={employer ? 'page' : undefined}>
                  Employers
                </Link>
              </li>
            </ul>
          </nav>
          <h2 id="plans-title" className={clsx(page.subhead, page.flush)}>Plans</h2>
          {shown.length === 0 && (
            <div className={s.notice} role="alert">
              <strong>Plans can’t be loaded right now.</strong> <Link href="/contact?intent=demo" className={marketing.textLink}>Talk to sales</Link> for current pricing.
            </div>
          )}
          <ul className={page.plans}>
            {shown.map((plan) => {
              const p = price(plan);
              const contactSales = plan.priceMinor === null;
              return (
                <li key={plan.id} className={clsx(page.plan, plan.highlighted && page.planPopular)}>
                  <div className={page.planHead}>
                    <h3 className={page.planName}>{plan.name}</h3>
                    {plan.highlighted && <span className={page.tag}>Most popular</span>}
                  </div>
                  <p className={page.planDesc}>{plan.tagline}</p>
                  <p className={page.price}>
                    {p.amount}
                    {p.per && <span className={page.pricePer}>{p.per}</span>}
                  </p>
                  {!employer && (
                    <p className={page.planCredits}>
                      {plan.monthlyCredits > 0 ? `${plan.monthlyCredits} AI credits every month` : 'Pay-as-you-go AI credits'}
                    </p>
                  )}
                  <Bullets items={plan.features} />
                  <div className={page.planCta}>
                    {contactSales || (!employer && plan.id === 'enterprise')
                      ? <Link href="/contact?intent=demo" className={`${marketing.btn} ${marketing.btnPrimary}`}>Contact sales</Link>
                      : !employer && plan.id === 'pro'
                        ? <ProPlanCta />
                        : <PrimaryCta label="Get started" href={employer ? `${REGISTER_PATH}?role=Employer` : REGISTER_PATH} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {!employer && (
        <section className={page.block} aria-labelledby="credits-title">
          <div className={marketing.container}>
            <div className={page.blockHead}>
              <span className={marketing.eyebrow}>Credits</span>
              <h2 id="credits-title" className={marketing.h2}>Credits overview</h2>
              <p className={marketing.lede}>
                Credits pay for AI-powered features. <strong>1 credit = ₹{RUPEES_PER_CREDIT}</strong>, and bulk top-up packs save up
                to 30%. Credits are refunded automatically if an AI feature fails, and the oldest credits are spent first.
              </p>
            </div>
            {credits && (
              <ul className={marketing.grid3}>
                <li className={marketing.card}>
                  <h3 className={marketing.cardTitle}>Earning credits</h3>
                  <Bullets items={[
                    `${credits.welcomeBonusCredits} credits when you join`,
                    `${credits.referralBonusCredits} credits per referral (up to ${credits.maxReferralsPerUser})`,
                    'Top up any time from your wallet',
                  ]} />
                </li>
                <li className={marketing.card}>
                  <h3 className={marketing.cardTitle}>Proposal tiers</h3>
                  <Bullets items={credits.proposalBudgetTiers.map((t) => `Budgets up to ₹${t.toLocaleString('en-IN')}`)} />
                </li>
                <li className={marketing.card}>
                  <h3 className={marketing.cardTitle}>Wallet</h3>
                  <Bullets items={['Balance and history in one place', 'Wallet credits are separate from contract earnings']} />
                </li>
              </ul>
            )}
            <h3 id="cost-reference" className={page.subhead}>Credit cost reference</h3>
            <div className={page.costTableWrap}>
              <table className={page.costTable} aria-labelledby="cost-reference">
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col" className={page.num}>Credits</th>
                    <th scope="col" className={page.num}>At ₹{RUPEES_PER_CREDIT}/credit</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.map((c) => (
                    <tr key={c.feature}>
                      <th scope="row">{c.label}</th>
                      <td className={page.num}>{costLabel(c)}</td>
                      <td className={page.num}>{costRupees(c)}</td>
                    </tr>
                  ))}
                </tbody>
                <caption>
                  Proposal cost depends on the project budget tier. If an AI feature fails, its credits are refunded automatically.
                </caption>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className={page.block} aria-labelledby="faq-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <h2 id="faq-title" className={marketing.h2}>Frequently asked questions</h2>
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
    </PageShell>
  );
}
