import type { Metadata } from 'next';
import { SITE_NAME, TWITTER_HANDLE } from '@/lib/site';

/**
 * Open Graph + Twitter fields for a page that customises them. Next replaces (not merges) a
 * parent's `openGraph` / `twitter` object when a page sets its own, so the site name, Twitter
 * handle and default share image must be repeated here. Pass `image: false` when the route
 * has its own opengraph-image file (it is then added automatically).
 */
export function shareMeta({ title, description, type = 'website', image = '/opengraph-image', publishedTime, tags }: {
  title: string;
  description: string;
  type?: 'website' | 'article';
  image?: string | false;
  publishedTime?: string;
  tags?: string[];
}): Pick<Metadata, 'openGraph' | 'twitter'> {
  const images = image ? [{ url: image, width: 1200, height: 630, alt: title }] : undefined;
  return {
    openGraph: {
      siteName: SITE_NAME,
      locale: 'en_IN',
      title,
      description,
      ...(type === 'article' ? { type: 'article', publishedTime, tags } : { type: 'website' }),
      ...(images ? { images } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      site: TWITTER_HANDLE,
      title,
      description,
      ...(images ? { images: images.map((i) => i.url) } : {}),
    },
  };
}
