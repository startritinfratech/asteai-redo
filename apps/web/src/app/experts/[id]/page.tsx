import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import pages from '@/features/marketing/pages.module.css';
import { ExpertProfileView } from '@/features/profiles/ExpertProfileView';
import { PrivateExpertPreview } from '@/features/profiles/PrivateExpertPreview';
import { fetchExpert } from '@/features/profiles/server';
import styles from '@/features/profiles/profiles.module.css';

interface Props { params: { id: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const expert = await fetchExpert(params.id).catch(() => null);
  if (!expert) return { title: 'Expert profile', robots: { index: false } };
  return {
    title: `${expert.name} — ${expert.headline || 'Expert'}`,
    description: (expert.summary || expert.headline).slice(0, 160),
    alternates: { canonical: `/experts/${expert.userId}` },
  };
}

export default async function ExpertPage({ params }: Props) {
  const expert = await fetchExpert(params.id);
  return (
    <PageShell>
      <div className={marketing.container}>
        <nav aria-label="Breadcrumb" className={styles.muted} style={{ paddingTop: 24 }}>
          <Link href="/experts">← All experts</Link>
        </nav>
        {expert ? (
          <>
            <h1 className={pages.title} style={{ marginTop: 16 }}>{expert.name}</h1>
            <p className={pages.lede} style={{ marginTop: 8, marginBottom: 20 }}>{expert.headline}</p>
            <ExpertProfileView expert={expert} />
          </>
        ) : (
          <>
            <h1 className={styles.srOnly}>Expert profile</h1>
            <PrivateExpertPreview id={params.id} />
          </>
        )}
      </div>
    </PageShell>
  );
}
