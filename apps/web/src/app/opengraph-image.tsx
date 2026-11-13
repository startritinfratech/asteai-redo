import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from '@/features/marketing/ogImage';

export const alt = 'ASTEAI — Hiring, delivered';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
// Edge: next/og's Node runtime can't load its bundled font on Windows builds (Invalid URL).
export const runtime = 'edge';

/** Default share image for every page that doesn't define its own. */
export default function Image() {
  return ogCard({ eyebrow: 'Talent delivery system', title: 'Hire and get hired on evidence, not résumés.' });
}
