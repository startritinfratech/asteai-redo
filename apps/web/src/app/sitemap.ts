import type { MetadataRoute } from 'next';
import { LEGAL_DOCS } from '@/features/marketing/legal/documents';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Public, signed-out pages only. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    '/',
    '/how-it-works',
    '/pricing',
    '/experts',
    '/about',
    '/contact',
    '/legal',
    ...LEGAL_DOCS.map((d) => `/legal/${d.slug}`),
    '/auth/register',
    '/auth/login',
  ];
  return paths.map((path) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
    changeFrequency: path.startsWith('/legal') ? 'yearly' : 'monthly',
    priority: path === '/' ? 1 : 0.6,
  }));
}
