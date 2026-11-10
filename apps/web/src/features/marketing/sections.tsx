/**
 * Landing page sections. All static Server Components; the only client pieces are the
 * auth-aware CTAs and the certificate lookup form.
 */
import Link from 'next/link';
import { clsx } from 'clsx';
import { PrimaryCta, REGISTER_PATH } from './AuthAwareActions';
import { VerifyCertificateForm } from './VerifyCertificateForm';
import styles from './marketing.module.css';

// ── Icons (decorative; always aria-hidden) ───────────────────────────────────
export type IconName = 'check' | 'briefcase' | 'badge' | 'handshake' | 'brain' | 'people' | 'repeat' | 'mic' | 'video'
  | 'lock' | 'log' | 'eyeOff' | 'shield' | 'user' | 'clock';

const PATHS: Record<IconName, string> = {
  check: 'M4 12.5l5 5L20 6.5',
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  badge: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6zM9 12l2 2 4-4',
  handshake: 'M3 12l4-4 5 3 5-3 4 4M7 8l5 9 5-9M3 12v4M21 12v4',
  brain: 'M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V4zm6 0a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 0',
  people: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 010 6M18 14c1.8.8 3 2.6 3 6',
  repeat: 'M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2M20 4v5h-5M4 20v-5h5',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3',
  video: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  log: 'M6 3h9l4 4v14H6zM9 9h6M9 13h6M9 17h4',
  eyeOff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 6c5 0 9 6 9 6a17 17 0 01-2.7 3.3M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a9 9 0 004.3-1.1',
  shield: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4.4 3.6-8 8-8s8 3.6 8 8',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className={styles.bullets}>
      {items.map((t) => (
        <li key={t}>
          <Icon name="check" size={16} className={styles.check} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionHead({ id, eyebrow, title, children }: {
  id: string; eyebrow: string; title: string; children?: React.ReactNode;
}) {
  return (
    <div className={styles.sectionHead}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h2 id={id} className={styles.h2}>{title}</h2>
      {children && <p className={styles.lede}>{children}</p>}
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
const SAMPLE_SCORES = [
  { label: 'Reasoning', value: 82 },
  { label: 'People', value: 76 },
  { label: 'Persistence', value: 88 },
] as const;

export function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={`${styles.container} ${styles.heroGrid}`}>
        <div>
          <span className={styles.eyebrow}>Hiring &amp; expert marketplace</span>
          <h1 id="hero-title" className={styles.h1}>
            Hire and get hired on <span className={styles.accent}>evidence</span>, not résumés.
          </h1>
          <p className={styles.heroText}>
            AsteAI runs AI interviews and role-fit assessments, scores them on the server, and turns the results into a
            Talent Passport anyone can verify. When the job is a project rather than a hire, vetted experts deliver it
            with payment held in escrow.
          </p>
          <div className={styles.ctaRow}>
            <PrimaryCta label="Get started" />
            <a href="#assessments" className={styles.btn}>How assessments work</a>
          </div>
          <ul className={styles.points}>
            <li><Icon name="check" size={16} className={styles.check} />Scored on the server</li>
            <li><Icon name="check" size={16} className={styles.check} />No camera recording</li>
            <li><Icon name="check" size={16} className={styles.check} />Escrow-protected projects</li>
          </ul>
        </div>

        <figure className={styles.passport} aria-labelledby="sample-caption">
          <div className={styles.passportTop}>
            <div>
              <div className={styles.passportKicker}>Talent Passport</div>
              <div className={styles.passportName}>Ananya R.</div>
              <div className={styles.passportRole}>Staff Nurse · ICU track</div>
            </div>
            <span className={styles.badge}>
              <Icon name="badge" size={14} />
              Verified
            </span>
          </div>
          <dl className={styles.meters}>
            {SAMPLE_SCORES.map((s) => (
              <div key={s.label} className={styles.meter}>
                <div className={styles.meterHead}>
                  <dt>{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
                <div className={styles.meterTrack} aria-hidden="true">
                  <div className={styles.meterFill} style={{ width: `${s.value}%` }} />
                </div>
              </div>
            ))}
          </dl>
          <div className={styles.passportFoot}>
            <span>Integrity: reviewed, no flags</span>
            <span>verify/certificate/…</span>
          </div>
          <figcaption id="sample-caption" className={styles.sampleNote}>
            Sample Talent Passport with illustrative scores
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

// ── Three journeys ───────────────────────────────────────────────────────────
export function Journeys() {
  return (
    <section id="journeys" className={styles.section} aria-labelledby="journeys-title">
      <div className={styles.container}>
        <SectionHead id="journeys-title" eyebrow="Who it’s for" title="One platform, three ways in">
          Employers hire on assessed role fit, candidates prove their skills once and reuse the proof, and experts take on
          scoped projects that buyers fund through escrow.
        </SectionHead>

        <ul className={styles.grid3}>
          <li className={styles.card}>
            <span className={styles.icon}><Icon name="briefcase" /></span>
            <span className={styles.audience}>Employers &amp; HR</span>
            <h3 className={styles.cardTitle}>Hiring without the screening circus</h3>
            <Bullets
              items={[
                'Open requisitions and move applicants through one pipeline',
                'Shortlist on assessed role fit, with fairness analytics',
                'Run AI and human interviews, then send offers',
                'Verify any candidate’s certificate in one step',
              ]}
            />
            <div className={styles.cardActions}>
              <Link href={`${REGISTER_PATH}?role=Employer`} className={clsx(styles.btn, styles.btnSm)}>
                Start hiring
              </Link>
            </div>
          </li>

          <li className={styles.card}>
            <span className={clsx(styles.icon, styles.iconMint)}><Icon name="badge" /></span>
            <span className={styles.audience}>Candidates</span>
            <h3 className={styles.cardTitle}>One assessment, many employers</h3>
            <Bullets
              items={[
                'Take a role-fit assessment instead of a new screen for every job',
                'Earn a Talent Passport with certificates anyone can verify',
                'Practise in the AI Interview Studio before the real thing',
                'Track every application and control what you share',
              ]}
            />
            <div className={styles.cardActions}>
              <Link href={`${REGISTER_PATH}?role=Candidate`} className={clsx(styles.btn, styles.btnSm)}>
                Claim your Passport
              </Link>
            </div>
          </li>

          <li className={styles.card}>
            <span className={clsx(styles.icon, styles.iconGold)}><Icon name="handshake" /></span>
            <span className={styles.audience}>Experts &amp; buyers</span>
            <h3 className={styles.cardTitle}>Expertise, delivered under escrow</h3>
            <Bullets
              items={[
                'Experts find projects, send proposals and get paid per milestone',
                'Buyers hire vetted experts or order pre-packaged services',
                'Milestone funds sit in escrow until the work is accepted',
                'Disagreements go to a dispute process, not a shouting match',
              ]}
            />
            <div className={styles.cardActions}>
              <Link href={`${REGISTER_PATH}?role=Freelancer`} className={clsx(styles.btn, styles.btnSm)}>
                Join as an expert
              </Link>
              <Link href={`${REGISTER_PATH}?role=Buyer`} className={clsx(styles.btn, styles.btnSm)}>
                Buy expertise
              </Link>
            </div>
          </li>
        </ul>
      </div>
    </section>
  );
}

// ── Assessments ──────────────────────────────────────────────────────────────
export function Assessments() {
  return (
    <section id="assessments" className={styles.section} aria-labelledby="assessments-title">
      <div className={styles.container}>
        <SectionHead id="assessments-title" eyebrow="Role-fit assessments" title="Measure how people work, not how they write a CV">
          Every assessment looks at three things that predict how someone will do in a role. Answers are scored on our
          servers, never in the browser, so results can&apos;t be edited on the way.
        </SectionHead>

        <ul className={styles.grid3}>
          <li className={styles.card}>
            <span className={styles.icon}><Icon name="brain" /></span>
            <h3 className={styles.cardTitle}>Reasoning</h3>
            <p className={styles.cardText}>
              Pattern grids, number series and short data tables: can you spot the rule and read the numbers that
              matter?
            </p>
          </li>
          <li className={styles.card}>
            <span className={clsx(styles.icon, styles.iconMint)}><Icon name="people" /></span>
            <h3 className={styles.cardTitle}>People</h3>
            <p className={styles.cardText}>
              Realistic workplace scenes and messages: how you respond to a colleague or customer, and how well you read
              tone.
            </p>
          </li>
          <li className={styles.card}>
            <span className={clsx(styles.icon, styles.iconGold)}><Icon name="repeat" /></span>
            <h3 className={styles.cardTitle}>Persistence</h3>
            <p className={styles.cardText}>
              Crack-the-code puzzles that reward sticking with a problem and learning from each attempt.
            </p>
          </li>
        </ul>

        <div className={styles.split}>
          <div>
            <h3 className={styles.h3}>How a session runs</h3>
            <ol className={styles.steps}>
              <li>
                <span><strong>See what’s recorded first.</strong> Before you start, a consent screen lists exactly what
                is captured and what isn’t.</span>
              </li>
              <li>
                <span><strong>Answer at your own pace.</strong> Leaving the page pauses you; it is logged, not
                penalised.</span>
              </li>
              <li>
                <span><strong>Scored on the server.</strong> Your answers are checked server-side, so the result is the
                same whoever looks at it.</span>
              </li>
              <li>
                <span><strong>People review flags.</strong> A person reviews any integrity flag before an employer ever
                sees it.</span>
              </li>
              <li>
                <span><strong>Results go on your Passport.</strong> You decide which employers can see them.</span>
              </li>
            </ol>
          </div>

          <aside className={styles.callout} aria-label="What we record">
            <p className={styles.calloutText}>
              <strong>Recorded:</strong> your answers, how long each one takes, whether the page leaves the foreground,
              and pastes.
            </p>
            <p className={styles.calloutText}>
              <strong>Never recorded:</strong> your camera, microphone or location.
            </p>
            <p className={styles.calloutText}>
              <strong>Need more time?</strong> Extra-time accommodations of +25% or +50% are available. Ask support
              before you start.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}

// ── Talent Passport ──────────────────────────────────────────────────────────
export function Passport() {
  return (
    <section id="passport" className={styles.section} aria-labelledby="passport-title">
      <div className={`${styles.container} ${styles.split}`} style={{ marginTop: 0 }}>
        <div>
          <SectionHead id="passport-title" eyebrow="Talent Passport" title="Proof that travels with you">
            Your assessment results and interview outcomes are collected in one Talent Passport. Each certificate has its
            own ID and a public page that confirms it is genuine.
          </SectionHead>
          <Bullets
            items={[
              'Take the assessment once, then share the result with any employer',
              'Each certificate links to a public verification page',
              'You choose what is shared, under Privacy & Consent',
              'Employers check a certificate without needing your login',
            ]}
          />
        </div>
        <div>
          <VerifyCertificateForm />
          <p className={styles.verifyHint} style={{ marginTop: 12 }}>
            Certificates are checked at <span className={styles.mono}>/verify/certificate/&lt;id&gt;</span>.
          </p>
        </div>
      </div>
    </section>
  );
}

// ── AI tools ─────────────────────────────────────────────────────────────────
export function AiTools() {
  return (
    <section id="ai" className={styles.section} aria-labelledby="ai-title">
      <div className={styles.container}>
        <SectionHead id="ai-title" eyebrow="AI that does the legwork" title="Practise, interview and get around by voice">
          AI handles the repetitive parts of hiring so people can spend their time on decisions.
        </SectionHead>
        <ul className={styles.grid2}>
          <li className={styles.card}>
            <span className={styles.icon}><Icon name="video" /></span>
            <h3 className={styles.cardTitle}>AI Interview Studio</h3>
            <p className={styles.cardText}>
              Candidates rehearse role-specific interviews and get feedback before the real one. Employers run
              structured AI interviews so every applicant gets the same questions and a fair hearing.
            </p>
          </li>
          <li className={styles.card}>
            <span className={clsx(styles.icon, styles.iconMint)}><Icon name="mic" /></span>
            <h3 className={styles.cardTitle}>Voice assistant</h3>
            <p className={styles.cardText}>
              Push to talk (or press Alt+V) to move around the platform and get things done hands-free. It asks before
              doing anything that changes your data, and it switches off during assessments.
            </p>
          </li>
        </ul>
      </div>
    </section>
  );
}

// ── Trust & security ─────────────────────────────────────────────────────────
const TRUST: { icon: IconName; tone?: string; title: string; text: string }[] = [
  { icon: 'lock', title: 'Escrow-protected projects', text: 'Buyers fund each milestone up front. The money is held in escrow and released to the expert when the work is accepted.' },
  { icon: 'shield', tone: styles.iconMint, title: 'Server-side scoring', text: 'Assessments are scored on our servers, not in the browser, so results can’t be altered on the way.' },
  { icon: 'eyeOff', tone: styles.iconRose, title: 'No camera recording', text: 'Assessments never record your camera, microphone or location. What is recorded is shown before you start.' },
  { icon: 'user', tone: styles.iconGold, title: 'Humans review integrity flags', text: 'Automated checks raise flags; a person decides. Nothing reaches an employer unreviewed.' },
  { icon: 'log', title: 'Audit trail', text: 'Administrative actions are written to an audit log, and disputes and appeals have their own review queue.' },
  { icon: 'clock', tone: styles.iconMint, title: 'Accommodations', text: 'Extra time is available on request, and stepping away from an assessment is logged, never penalised.' },
];

export function Trust() {
  return (
    <section id="trust" className={styles.section} aria-labelledby="trust-title">
      <div className={styles.container}>
        <SectionHead id="trust-title" eyebrow="Trust & security" title="Built to be trusted by both sides">
          Hiring decisions and payments only work when everyone believes the numbers. These are the safeguards behind
          them.
        </SectionHead>
        <ul className={styles.gridAuto}>
          {TRUST.map((t) => (
            <li key={t.title} className={styles.card}>
              <span className={clsx(styles.icon, t.tone)}><Icon name={t.icon} /></span>
              <h3 className={styles.cardTitle}>{t.title}</h3>
              <p className={styles.cardText}>{t.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Final CTA ────────────────────────────────────────────────────────────────
export function FinalCta() {
  return (
    <section className={styles.section} aria-labelledby="final-title">
      <div className={styles.container}>
        <div className={styles.final}>
          <h2 id="final-title" className={styles.h2}>Start with evidence</h2>
          <p className={styles.lede}>
            Create an account as an employer, candidate, expert or buyer. It takes about a minute.
          </p>
          <div className={styles.ctaRow}>
            <PrimaryCta label="Create your account" />
            <a href="#journeys" className={styles.btn}>Compare the journeys</a>
          </div>
        </div>
      </div>
    </section>
  );
}
