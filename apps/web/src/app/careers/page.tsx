import type { Metadata } from 'next';
import type { CareerRole } from '@asteai/types';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';
import { CareerForm } from '@/features/public-forms/CareerForm';
import { SUPPORT_EMAIL } from '@/lib/site';
import { ApiNotFound, ApiUnavailable, serverGet } from '@/lib/serverApi';

export const metadata: Metadata = {
  title: { absolute: 'Careers at ASTEAI' },
  description: 'Open roles at ASTEAI. Help build the talent delivery system for every segment of the workforce.',
  alternates: { canonical: '/careers' },
};

const VALUES = [
  { title: 'Real impact', text: 'Empower workforces. Own systems. No corporate fog.' },
  { title: 'All talents', text: 'Frontline operations and professional roles on a single platform.' },
  { title: 'High autonomy', text: 'We trust problem solvers, not micromanagement.' },
] as const;

export default async function CareersPage() {
  let roles: CareerRole[] | null = null;
  try {
    roles = await serverGet<CareerRole[]>('/careers/roles', { revalidate: 300 });
  } catch (err) {
    if (!(err instanceof ApiUnavailable || err instanceof ApiNotFound)) throw err;
  }

  return (
    <PageShell>
      <PageHero eyebrow="We’re hiring" title="Build the future of unified hiring">
        We’re building the enterprise system for AI talent sourcing and management, serving every segment of the
        workforce, from frontline teams to specialist engineers, in their own language.
      </PageHero>
      <div className={marketing.container}>
        <section className={s.section} aria-labelledby="roles-h">
          <h2 id="roles-h" className={s.sectionTitle}>Open positions</h2>
          {!roles && (
            <div className={s.notice} role="alert">
              <strong>Open roles can’t be loaded right now.</strong> Email your CV to {SUPPORT_EMAIL} with the role in the subject.
            </div>
          )}
          {roles && roles.length === 0 && <p className={s.sectionLede}>No open roles right now. Check back soon.</p>}
          {roles && roles.length > 0 && (
            <ul className={`${s.grid} ${s.grid3}`} style={{ marginTop: 24 }}>
              {roles.map((r) => (
                <li key={r.slug} className={s.card}>
                  <div className={s.cardMeta}>
                    {r.team && <span>{r.team}</span>}
                    <span>{r.location}</span>
                  </div>
                  <h3 className={s.cardTitle}>{r.title}</h3>
                  <p className={s.cardText}>{r.skills}</p>
                  <div className={s.cardFoot}>
                    <a href="#apply" className={marketing.textLink}>Apply<span className={s.srOnlyInline}> for {r.title}</span> →</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {roles && roles.length > 0 && (
          <section className={s.section} aria-label="Application form">
            <div style={{ maxWidth: 720 }}>
              <CareerForm roles={roles} />
            </div>
          </section>
        )}

        <section className={s.section} aria-labelledby="why-h">
          <h2 id="why-h" className={s.sectionTitle}>Why join ASTEAI?</h2>
          <ul className={`${s.grid} ${s.grid3}`} style={{ marginTop: 24, marginBottom: 24 }}>
            {VALUES.map((v) => (
              <li key={v.title} className={s.card}>
                <h3 className={s.cardTitle}>{v.title}</h3>
                <p className={s.cardText}>{v.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
