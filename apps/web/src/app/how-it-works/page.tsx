import type { Metadata } from 'next';
import { JsonLd } from '@/features/marketing/JsonLd';
import { faqLd } from '@/features/marketing/structuredData';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import { PrimaryCta } from '@/features/marketing/AuthAwareActions';
import { Bullets } from '@/features/marketing/sections';
import marketing from '@/features/marketing/marketing.module.css';
import page from '@/features/marketing/pages.module.css';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'How buyers and experts work on ASTEAI: projects, proposals, contracts with escrow protection, expert tiers, credits and safety.',
  alternates: { canonical: '/how-it-works' },
};

// Content as published on the production "How It Works" page.
interface Step { title: string; description: string; details: string[] }

const BUYER_STEPS: Step[] = [
  {
    title: 'Create Account & Profile',
    description: 'Sign up as a buyer, verify your email, and complete your company profile',
    details: ['Register with email and password', 'Verify email address', 'Fill in company details (name, size, industry)', 'Add company website and description', 'Complete KYC/verification process'],
  },
  {
    title: 'Post a Project',
    description: 'Create a detailed project request with requirements and budget',
    details: ['Define project title and description', 'Specify technical domain and TRL level', 'Set budget range (min & max)', 'Add risk categories and expected outcomes', 'Set project deadline', 'Save as draft or publish immediately'],
  },
  {
    title: 'Review Expert Proposals',
    description: 'Receive and evaluate proposals from qualified experts',
    details: ['View incoming proposals from experts', 'Review expert profiles and ratings', 'Compare proposed timelines and rates', 'Read expert’s approach and experience', 'View expert’s scoring and badges', 'Message experts for clarifications'],
  },
  {
    title: 'Select & Contract',
    description: 'Choose the best expert and create a legally binding contract',
    details: ['Select winning proposal', 'Choose engagement model (daily, hourly, fixed, sprint)', 'Review NDA terms (can customize)', 'Sign service agreement', 'Expert signs NDA', 'Create and fund escrow account'],
  },
  {
    title: 'Fund Work',
    description: 'Secure funds in escrow to initiate work',
    details: ['Fund escrow account with contract amount', 'Funds held securely during project duration', 'Released upon milestone completion', 'Can adjust if payment model is hourly/daily', 'Escrow ensures expert protection'],
  },
  {
    title: 'Monitor Progress',
    description: 'Track work, communicate, and manage project timeline',
    details: ['View real-time work logs and time entries', 'Review daily/sprint summaries', 'Communicate via messaging system', 'Receive status notifications', 'Request revisions if needed', 'Approve completed work'],
  },
  {
    title: 'Review & Release Payment',
    description: 'Accept deliverables and release funds from escrow',
    details: ['Review final deliverables', 'Verify contract completion', 'Accept or request modifications', 'Release payment from escrow', 'Leave feedback and rating', 'Submit any disputes if issues arise'],
  },
];

const EXPERT_STEPS: Step[] = [
  {
    title: 'Create Account & Profile',
    description: 'Register as an expert and build your professional profile',
    details: ['Sign up with email and password', 'Verify email address', 'Complete expert profile with bio', 'Add technical skills and expertise areas', 'Upload portfolio or certifications', 'Set hourly/daily rates'],
  },
  {
    title: 'Complete AI Interview (Recommended)',
    description: 'Boost your profile ranking and credibility by passing a proctored AI evaluation',
    details: ['Interview in your native language (14+ supported)', 'Fully proctored (video, audio, and attention tracked)', 'Natural voice conversation with our AI', 'Costs 25 credits for preverification, 25 credits to initiate the session', 'Completes in 15 conversational exchanges', 'Will be evaluated by admin team who will improve your profile ranking and score based on your performance'],
  },
  {
    title: 'Browse Projects',
    description: 'Explore enterprise engagements matched to your verified skills',
    details: ['Access your matched engagement feed', 'Filter by domain, budget, and deadline', 'Search for specific project types', 'View detailed project requirements', 'See buyer’s company profile', 'Check project budget and timeline'],
  },
  {
    title: 'Submit Proposal',
    description: 'Create a compelling proposal to win the project',
    details: ['Click ‘Submit Proposal’ on project', 'Enter proposed rate and timeline', 'Write detailed approach and methodology', 'Highlight relevant experience', 'Mention similar projects completed', 'Propose engagement model preference'],
  },
  {
    title: 'Negotiate & Contract',
    description: 'Finalize terms and sign the contract',
    details: ['Wait for buyer’s response to proposal', 'Negotiate terms if buyer counters', 'Review and sign NDA', 'Review service agreement', 'Sign contract', 'Confirm start date and engagement model'],
  },
  {
    title: 'Start Work',
    description: 'Begin project work and track your time/progress',
    details: ['Receive contract activation notification', 'Start work on agreed timeline', 'Log time entries (for hourly contracts)', 'Create work logs and daily summaries', 'Document progress and deliverables', 'Communicate with buyer regularly'],
  },
  {
    title: 'Complete Deliverables',
    description: 'Finish work and prepare for buyer review',
    details: ['Complete all project requirements', 'Submit all agreed deliverables', 'Ensure quality meets standards', 'Document code/work properly', 'Prepare for buyer review/acceptance', 'Be available for revisions if needed'],
  },
  {
    title: 'Receive Payment & Feedback',
    description: 'Get paid and build your reputation through ratings',
    details: ['Buyer accepts deliverables', 'Payment released from escrow', 'Funds deposited to your wallet', 'Receive buyer’s feedback and rating', 'Rating impacts your score and visibility', 'Build portfolio with completed projects'],
  },
];

const KEY_FEATURES = [
  { title: 'Escrow Protection', text: 'Funds held securely throughout contract duration, protecting both parties' },
  { title: 'Multi-Model Engagement', text: 'Support for daily, hourly, fixed-price, and sprint-based contracts' },
  { title: 'Work Tracking', text: 'Real-time time logs, work summaries, and progress monitoring' },
  { title: 'NDA & Contracts', text: 'Legal framework with digital signatures and customizable NDAs' },
  { title: 'Rating System', text: 'Earn badges and improve your score based on project performance' },
  { title: 'Messaging System', text: 'Built-in communication platform for seamless collaboration' },
];

const ENGAGEMENT_MODELS = [
  { title: 'Hourly Rate', text: 'Best for ongoing, flexible projects', items: ['Pay based on actual hours worked', 'Expert logs time daily', 'Flexible scope and timeline'] },
  { title: 'Daily Rate', text: 'Best for short-term intensive work', items: ['Fixed daily rate and duration', 'Predictable cost structure', 'Expert commits specific days'] },
  { title: 'Fixed Price', text: 'Best for well-defined projects', items: ['Single price for full project', 'Clear scope and deliverables', 'Payment on completion'] },
  { title: 'Sprint Based', text: 'Best for iterative development', items: ['Fixed price per sprint', 'Defined sprint duration', 'Multiple sprints possible'] },
];

const SCORE_WEIGHTS = [
  { label: 'Profile Completion', pct: 40, text: 'Based on verified identity, skills, portfolio, and detailed bio.' },
  { label: 'Delivery Success', pct: 35, text: 'Calculated from on-time delivery rates, completed contracts, and minimal cancellations.' },
  { label: 'Reputation', pct: 25, text: 'Based on buyer ratings, repeat clients, and dispute-free resolutions.' },
];

const TIERS = [
  { name: 'Elite Expert (Level 5)', score: '90-100 Score • 30+ Jobs Completed' },
  { name: 'Senior Expert (Level 4)', score: '70-89 Score • 15+ Jobs Completed' },
  { name: 'Established Expert (Level 3)', score: '45-69 Score • 8+ Jobs Completed' },
  { name: 'Rising Expert (Level 2)', score: '20-44 Score • 3+ Jobs Completed' },
  { name: 'Newcomer (Level 1)', score: '0-19 Score • Getting Started' },
];

const CREDITS = {
  buyers: {
    costs: [['Invite Expert Directly', '6 credits'], ['Find Experts — AI Search', '15 credits'], ['Find Experts with AI', '15 credits']],
    free: ['Post a Project', 'Browse Expert Profiles', 'Accept / Decline Proposals', 'Messaging & Replies', 'Leave Reviews & Ratings'],
  },
  experts: {
    costs: [
      ['Submit Proposal', '3–12 credits'],
      ['AI Profile Analysis / Auto-Fill', '15 credits'],
      ['AI Recommendations (Find Work)', '6 credits'],
      ['AI Interview Pre-Verification', '25 credits'],
      ['Take Proctored AI Interview', '25 credits'],
    ],
    free: ['Browse Engagements', 'View Project Listings', 'Submit Work / Milestones', 'Messaging & Replies', 'Leave Reviews & Ratings'],
  },
} as const;

const SAFETY = [
  {
    title: 'For Buyers',
    items: [
      ['Escrow Protection:', 'Payment held until work is completed'],
      ['Expert Verification:', 'View ratings and completed projects'],
      ['Dispute Resolution:', 'Formal process for handling disagreements'],
      ['NDA Protection:', 'Legally binding confidentiality agreements'],
    ],
  },
  {
    title: 'For Experts',
    items: [
      ['Payment Security:', 'Funds escrowed before work begins'],
      ['Buyer Verification:', 'Check company and payment history'],
      ['Dispute Protection:', 'Fair resolution mechanism available'],
      ['Reputation Building:', 'Earn ratings to increase visibility'],
    ],
  },
] as const;

const FAQS = [
  { q: 'What happens if I’m not satisfied with the work?', a: 'You can request revisions during the contract period. If issues persist, the platform provides a formal dispute resolution process where both parties present evidence. If unresolved, funds remain in escrow until resolved through mediation or arbitration.' },
  { q: 'How does escrow work?', a: 'The buyer funds the escrow account when the contract becomes active. The funds are held securely by the platform. Upon project completion and acceptance, the funds are released to the expert. If there’s a dispute, funds remain protected until resolution.' },
  { q: 'Can I negotiate rates in a proposal?', a: 'Yes, after an expert submits a proposal, the buyer can counter-offer different rates or terms. The expert can accept, reject, or counter-counter-offer. Once both parties agree, the contract is created and signed.' },
  { q: 'What is the rating system?', a: 'After project completion, both parties leave ratings and feedback. Experts earn badges and improve their scoring tier based on ratings, project completion, and performance. Higher-rated experts appear higher in search results and are more likely to win projects.' },
  { q: 'How are invoices handled?', a: 'For hourly/daily contracts, experts submit invoices for work completed. The buyer reviews and approves them. Funds are drawn from the escrow account. For fixed-price contracts, the expert submits an invoice upon completion, which the buyer approves before release of full payment.' },
  { q: 'Is my intellectual property protected?', a: 'Each contract includes an NDA that protects both parties’ intellectual property. The terms can be customized based on your agreement. Once signed, it’s a legally binding document that protects confidentiality and IP rights.' },
  { q: 'How do credits work?', a: 'Credits are the platform’s currency for premium actions like submitting proposals and using AI features. 1 credit = ₹5. You can buy credits in packs with bulk discounts of up to 30%. Every new user gets 5 free credits after completing their profile.' },
  { q: 'Do credits expire?', a: 'Yes, credits expire 12 months after purchase. However, purchasing new credits extends the expiry of your entire remaining balance by another 12 months (rolling reset). Credits are spent oldest-first (FIFO), so your freshest credits stay longest.' },
  { q: 'Can I get a refund on spent credits?', a: 'In certain cases, yes. If a buyer cancels their project or never opens your proposal within 72 hours, you receive a full refund. If you withdraw your own proposal, you get 50% back. If your proposal is rejected, credits are not refunded — this prevents spam proposals. AI credits are also refunded if the AI call fails.' },
];

function Steps({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol className={page.stepList} aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.title} className={page.step}>
          <span className={page.stepNum} aria-hidden="true">{i + 1}</span>
          <div>
            <h3 className={page.stepTitle}>{s.title}</h3>
            <p className={page.stepDesc}>{s.description}</p>
            <Bullets items={s.details} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function CostCard({ title, rows }: { title: string; rows: readonly (readonly [string, string])[] }) {
  return (
    <div className={marketing.card}>
      <h4 className={marketing.cardTitle}>{title}</h4>
      <ul className={page.tierList}>
        {rows.map(([label, cost]) => (
          <li key={label} className={page.cost}>
            <span>{label}</span>
            <span className={page.costValue}>{cost}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <PageShell>
      <JsonLd data={faqLd(FAQS)} />
      <PageHero eyebrow="Platform Guide" title="How It Works">
        Asteai Deeptech connects expert freelancers with buyers seeking specialized technical expertise. Whether
        you&apos;re hiring or offering your skills, here&apos;s how the platform works.
      </PageHero>
      <div className={marketing.container}>
        <ul className={page.jump} aria-label="Jump to a workflow">
          <li><a href="#buyers" className={`${marketing.btn} ${marketing.btnSm}`}>For Buyers</a></li>
          <li><a href="#experts" className={`${marketing.btn} ${marketing.btnSm}`}>For Experts</a></li>
        </ul>
      </div>

      <section id="buyers" className={page.block} aria-labelledby="buyers-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <span className={marketing.eyebrow}>For Buyers</span>
            <h2 id="buyers-title" className={marketing.h2}>Buyer Workflow</h2>
            <p className={marketing.lede}>
              Post your project, receive proposals from qualified experts, select the best fit, establish a contract
              with escrow protection, and collaborate until completion.
            </p>
          </div>
          <Steps steps={BUYER_STEPS} label="Buyer steps" />
        </div>
      </section>

      <section id="experts" className={page.block} aria-labelledby="experts-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <span className={marketing.eyebrow}>For Experts</span>
            <h2 id="experts-title" className={marketing.h2}>Expert Workflow</h2>
            <p className={marketing.lede}>
              Build your profile, browse projects, submit proposals, negotiate contracts, deliver quality work, and
              earn reputation through ratings and feedback.
            </p>
          </div>
          <Steps steps={EXPERT_STEPS} label="Expert steps" />
        </div>
      </section>

      <section className={page.block} aria-labelledby="features-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <h2 id="features-title" className={marketing.h2}>Key Features &amp; Protections</h2>
          </div>
          <ul className={marketing.gridAuto}>
            {KEY_FEATURES.map((f) => (
              <li key={f.title} className={marketing.card}>
                <h3 className={marketing.cardTitle}>{f.title}</h3>
                <p className={marketing.cardText}>{f.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={page.block} aria-labelledby="models-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <h2 id="models-title" className={marketing.h2}>Engagement Models</h2>
          </div>
          <ul className={marketing.grid2}>
            {ENGAGEMENT_MODELS.map((m) => (
              <li key={m.title} className={marketing.card}>
                <h3 className={marketing.cardTitle}>{m.title}</h3>
                <p className={marketing.cardText}>{m.text}</p>
                <Bullets items={m.items} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={page.block} aria-labelledby="tiers-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <h2 id="tiers-title" className={marketing.h2}>Expert Tiers &amp; Scoring System</h2>
            <p className={marketing.lede}>
              Asteai Deeptech uses a comprehensive scoring system to evaluate expert performance. Higher scores unlock
              higher tiers, giving experts better visibility and access to premium projects.
            </p>
          </div>
          <div className={marketing.grid2}>
            <div className={marketing.card}>
              <h3 className={marketing.cardTitle}>How Scores Are Calculated</h3>
              <dl className={page.weights}>
                {SCORE_WEIGHTS.map((w) => (
                  <div key={w.label} className={page.weight}>
                    <div className={page.weightHead}>
                      <dt>{w.label}</dt>
                      <dd>{w.pct}%</dd>
                    </div>
                    <div className={page.track} aria-hidden="true">
                      <div className={page.fill} style={{ width: `${w.pct}%` }} />
                    </div>
                    <dd>{w.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className={marketing.card}>
              <h3 className={marketing.cardTitle}>Expert Tiers &amp; Ranks</h3>
              <ul className={page.tierList}>
                {TIERS.map((t) => (
                  <li key={t.name} className={page.tier}>
                    <span className={page.tierName}>{t.name}</span>
                    <span className={page.tierScore}>{t.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className={page.block} aria-labelledby="credits-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <h2 id="credits-title" className={marketing.h2}>Credits &amp; Wallet</h2>
            <p className={marketing.lede}>
              Asteai Deeptech uses a credit system for premium actions. <strong>1 Credit = ₹5.</strong> Buy credits in
              bulk for discounts, and manage everything from your Wallet.
            </p>
          </div>
          <div className={marketing.grid2}>
            <div className={page.aside}>
              <h3 className={marketing.h3}>For Buyers</h3>
              <CostCard title="What Costs Credits" rows={CREDITS.buyers.costs} />
              <div className={marketing.card}>
                <h4 className={marketing.cardTitle}>What&apos;s Free</h4>
                <Bullets items={CREDITS.buyers.free} />
              </div>
            </div>
            <div className={page.aside}>
              <h3 className={marketing.h3}>For Experts</h3>
              <CostCard title="What Costs Credits" rows={CREDITS.experts.costs} />
              <div className={marketing.card}>
                <h4 className={marketing.cardTitle}>What&apos;s Free</h4>
                <Bullets items={CREDITS.experts.free} />
              </div>
            </div>
          </div>
          <div className={`${marketing.grid2} ${page.gapTop}`}>
            <div className={marketing.card}>
              <h3 className={marketing.cardTitle}>Credit Expiry</h3>
              <Bullets
                items={[
                  'Credits expire 12 months after purchase',
                  'Buying more credits extends expiry by another 12 months (rolling reset)',
                  'Oldest credits are spent first (FIFO)',
                ]}
              />
            </div>
            <div className={marketing.card}>
              <h3 className={marketing.cardTitle}>Refund Policy</h3>
              <Bullets
                items={[
                  'Project cancelled by buyer → 100% refund',
                  'Buyer never opened proposal (72h) → 100% refund',
                  'Expert withdraws proposal → 50% refund',
                  'Proposal rejected → No refund (prevents spam)',
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={page.block} aria-labelledby="safety-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <h2 id="safety-title" className={marketing.h2}>Safety &amp; Security</h2>
          </div>
          <div className={marketing.grid2}>
            {SAFETY.map((group) => (
              <div key={group.title} className={marketing.card}>
                <h3 className={marketing.cardTitle}>{group.title}</h3>
                <ul className={page.plainList}>
                  {group.items.map(([bold, text]) => (
                    <li key={bold}>
                      <strong>{bold}</strong> {text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={page.block} aria-labelledby="faq-title">
        <div className={marketing.container}>
          <div className={page.blockHead}>
            <h2 id="faq-title" className={marketing.h2}>Frequently Asked Questions</h2>
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

      <section className={marketing.section} aria-labelledby="cta-title">
        <div className={marketing.container}>
          <div className={marketing.final}>
            <h2 id="cta-title" className={marketing.h2}>Ready to get started?</h2>
            <div className={marketing.ctaRow}>
              <PrimaryCta label="Create your account" />
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
