import { getPost } from '@/features/content';
import { ogCard, OG_CONTENT_TYPE, OG_SIZE } from '@/features/marketing/ogImage';

export const alt = 'ASTEAI Journal';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
// Edge: next/og's Node runtime can't load its bundled font on Windows builds (Invalid URL).
export const runtime = 'edge';

export default function Image({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  return ogCard({ eyebrow: `ASTEAI Journal · ${post?.category ?? 'Blog'}`, title: post?.title ?? 'ASTEAI Journal', footer: post ? `${post.readTime} min read · asteai.com/blog` : undefined });
}
