/** Site-wide constants: one place for the brand, contact points and social profiles. */
export const SITE_NAME = 'ASTEAI';

export const SUPPORT_EMAIL = 'supportasteai@startrit.com';

/** One X/Twitter handle for the footer link and the twitter:site meta tag. */
export const TWITTER_HANDLE = '@AsteAiAsteAi';

export const SOCIAL_LINKS = [
  { id: 'x', label: 'X (Twitter)', href: 'https://x.com/AsteAiAsteAi' },
  { id: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/company/asteai' },
  { id: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/_asteai_/' },
  { id: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/AsteAI/' },
  { id: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@asteai' },
] as const;

export type SocialId = (typeof SOCIAL_LINKS)[number]['id'];
