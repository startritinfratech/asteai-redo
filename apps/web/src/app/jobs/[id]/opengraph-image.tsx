import type { PublicJob } from '@asteai/types';
import { LOCATION_TYPE_LABEL } from '@/features/jobs/types';
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from '@/features/marketing/ogImage';
import { serverGet } from '@/lib/serverApi';

export const alt = 'Open role on ASTEAI';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
// Edge: next/og's Node runtime can't load its bundled font on Windows builds (Invalid URL).
export const runtime = 'edge';

/** A job's share card. Falls back to a generic card if the job can't be loaded. */
export default async function Image({ params }: { params: { id: string } }) {
  try {
    const job = await serverGet<PublicJob>(`/jobs/public/${encodeURIComponent(params.id)}`);
    return ogCard({
      eyebrow: `Hiring · ${job.company.name}`,
      title: job.title,
      footer: `${LOCATION_TYPE_LABEL[job.locationType]}${job.location ? ` · ${job.location}` : ''} · Apply on asteai.com`,
    });
  } catch {
    return ogCard({ eyebrow: 'Open roles', title: 'Find your next role on ASTEAI' });
  }
}
