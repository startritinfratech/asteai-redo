import type { MetadataRoute } from 'next';
import type { ExpertPage, PublicJobPage } from '@asteai/types';
import { CASE_STUDIES, POSTS } from '@/features/content';
import { LEGAL_DOCS } from '@/features/marketing/legal/documents';
import { serverGet } from '@/lib/serverApi';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Regenerate hourly: published jobs and approved experts change during the day. */
export const revalidate = 3600;

type Freq = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;

/** Public, indexable pages only (no /auth or /platform). */
const STATIC: readonly [path: string, freq: Freq, priority: number][] = [
  ['/', 'daily', 1],
  ['/for-companies', 'weekly', 0.95],
  ['/jobs', 'daily', 0.9],
  ['/pricing', 'weekly', 0.85],
  ['/pricing?audience=employer', 'weekly', 0.8],
  ['/how-it-works', 'monthly', 0.8],
  ['/blog', 'weekly', 0.8],
  ['/experts', 'daily', 0.75],
  ['/services', 'daily', 0.75],
  ['/case-studies', 'monthly', 0.7],
  ['/marketplace', 'weekly', 0.7],
  ['/products', 'weekly', 0.6],
  ['/for-experts', 'monthly', 0.7],
  ['/about', 'monthly', 0.6],
  ['/contact', 'monthly', 0.6],
  ['/careers', 'weekly', 0.6],
  ['/legal', 'yearly', 0.3],
];

/** Caps keep the sitemap well under the 50,000-URL limit and the build fast. */
const MAX_JOBS = 1000;
const MAX_EXPERTS = 1000;

async function publishedJobs(): Promise<{ id: string; createdAt: string }[]> {
  const out: { id: string; createdAt: string }[] = [];
  let cursor: string | undefined;
  try {
    do {
      const page: PublicJobPage = await serverGet<PublicJobPage>('/jobs/public', { params: { limit: 50, cursor }, revalidate });
      out.push(...page.items.map((j) => ({ id: j.id, createdAt: j.createdAt })));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && out.length < MAX_JOBS);
  } catch {
    // API down: ship the static part rather than failing the whole sitemap.
  }
  return out.slice(0, MAX_JOBS);
}

async function publicExperts(): Promise<string[]> {
  const ids: string[] = [];
  try {
    for (let page = 1; ids.length < MAX_EXPERTS; page++) {
      const res: ExpertPage = await serverGet<ExpertPage>('/experts', { params: { page, pageSize: 50 }, revalidate });
      ids.push(...res.items.map((e) => e.userId));
      if (page * res.pageSize >= res.total || res.items.length === 0) break;
    }
  } catch {
    // As above.
  }
  return ids.slice(0, MAX_EXPERTS);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const url = (path: string) => `${SITE_URL}${path === '/' ? '' : path}`;
  const [jobs, experts] = await Promise.all([publishedJobs(), publicExperts()]);
  return [
    ...STATIC.map(([path, changeFrequency, priority]) => ({ url: url(path), changeFrequency, priority })),
    ...POSTS.map((p) => ({ url: url(`/blog/${p.slug}`), lastModified: p.publishedAt, changeFrequency: 'yearly' as const, priority: 0.6 })),
    ...CASE_STUDIES.map((c) => ({ url: url(`/case-studies/${c.slug}`), lastModified: c.publishedAt, changeFrequency: 'yearly' as const, priority: 0.5 })),
    ...jobs.map((j) => ({ url: url(`/jobs/${j.id}`), lastModified: j.createdAt, changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...experts.map((id) => ({ url: url(`/experts/${id}`), changeFrequency: 'weekly' as const, priority: 0.5 })),
    ...LEGAL_DOCS.map((d) => ({ url: url(`/legal/${d.slug}`), changeFrequency: 'yearly' as const, priority: 0.3 })),
  ];
}
