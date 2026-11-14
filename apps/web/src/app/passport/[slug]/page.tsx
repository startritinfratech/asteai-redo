import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PassportProfile } from '@asteai/types';
import { PageShell } from '@/features/marketing/PageShell';
import { CompetencyBars } from '@/features/career/CompetencyBars';
import { percentileLabel } from '@/features/career/format';
import { ShareActions } from '@/features/career/ShareActions';
import { VerifyBadge } from '@/features/career/VerifyBadge';
import styles from '@/features/career/Passport.module.css';
import { ApiNotFound, ApiUnavailable, serverGet } from '@/lib/serverApi';

type Params = { slug: string };
type SearchParams = Record<string, string | string[] | undefined>;

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const CODE = /^AST-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;
const KIND_LABEL = { passport_snapshot: 'Passport snapshot', challenge: 'Code challenge', interview: 'AI interview' } as const;

async function load(slug: string): Promise<PassportProfile | 'unavailable' | null> {
  if (!SLUG.test(slug)) return null;
  try {
    // Anonymous fetch: only public passports come back.
    return await serverGet<PassportProfile>(`/passports/${encodeURIComponent(slug)}`, { revalidate: 60 });
  } catch (err) {
    if (err instanceof ApiNotFound) return null;
    if (err instanceof ApiUnavailable) return 'unavailable';
    throw err;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await load(params.slug);
  if (!p || p === 'unavailable') return { title: 'Talent Passport | ASTEAI', robots: { index: false } };
  const desc = p.headline || `Verified skills and results for ${p.holderName}.`;
  return {
    title: { absolute: `${p.holderName} · Verified Talent Passport | ASTEAI` },
    description: desc,
    alternates: { canonical: `/passport/${p.slug}` },
    openGraph: { title: `${p.holderName} · Verified Talent Passport`, description: desc, type: 'profile' },
  };
}

/** Public, shareable Verified Talent Passport. */
export default async function PublicPassportPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const p = await load(params.slug);
  if (!p) notFound();
  if (p === 'unavailable') {
    return (
      <PageShell>
        <div className={styles.wrap}><p className={styles.muted}>This passport can&apos;t be loaded right now. Please try again shortly.</p></div>
      </PageShell>
    );
  }

  // A shared snapshot (?credential=) is verified first; otherwise the newest credential.
  const asked = typeof searchParams.credential === 'string' ? searchParams.credential.toUpperCase() : '';
  const featured = CODE.test(asked) ? asked : p.credentials[0]?.code ?? null;

  return (
    <PageShell>
      <div className={styles.wrap}>
        <article className={styles.card} aria-labelledby="passport-name">
          <div className={styles.cardHead}>
            <div>
              <p className={styles.eyebrow}>Verified Talent Passport</p>
              <h1 id="passport-name" className={styles.name}>{p.holderName}</h1>
              {p.headline && <p className={styles.headline}>{p.headline}</p>}
            </div>
            {p.overall.score !== null && (
              <div className={styles.score}>
                <div className={styles.scoreValue}>{Math.round(p.overall.score)}</div>
                <div className={styles.scoreLabel}>Passport score · {percentileLabel(p.overall.percentile)}</div>
              </div>
            )}
          </div>
          {featured ? <VerifyBadge code={featured} slug={p.slug} knownCodes={p.credentials.map((c) => c.code)} /> : (
            <p className={styles.muted}>No signed credentials yet. Scores below come from results verified on ASTEAI.</p>
          )}
          <ShareActions title={`${p.holderName} · Verified Talent Passport`} />
        </article>

        <section className={styles.section} aria-labelledby="competencies">
          <h2 id="competencies" className={styles.h2}>Competencies</h2>
          <p className={styles.muted}>
            Every score comes from a graded code challenge or a scored AI interview on ASTEAI, never from self-assessment.
            Percentiles compare against everyone holding the same competency.
          </p>
          <CompetencyBars competencies={p.competencies} />
        </section>

        {p.credentials.length > 0 && (
          <section className={styles.section} aria-labelledby="credentials">
            <h2 id="credentials" className={styles.h2}>Signed credentials</h2>
            <ul className={styles.creds}>
              {p.credentials.map((c) => (
                <li key={c.code} className={styles.cred}>
                  <strong>{KIND_LABEL[c.kind] ?? c.kind}</strong>
                  <span className={styles.muted}>{new Date(c.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  <Link href={`/passport/${p.slug}?credential=${c.code}`}>{c.code}</Link>
                </li>
              ))}
            </ul>
            <p className={styles.muted}>
              Anyone can check a code independently: the API at <code>/api/v1/verify/&lt;code&gt;</code> returns the signed
              payload, and the public keys are at <code>/api/v1/verify/keys</code>.
            </p>
          </section>
        )}
      </div>
    </PageShell>
  );
}
