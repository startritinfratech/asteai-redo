/**
 * schema.org JSON-LD builders (render with <JsonLd data={…} />). Pure functions so the
 * shapes are unit-tested; absolute URLs come from NEXT_PUBLIC_SITE_URL.
 */
import { SITE_NAME, SOCIAL_LINKS } from '@/lib/site';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const absolute = (path: string) => (path.startsWith('http') ? path : `${SITE_URL}${path === '/' ? '' : path}`);

type Json = Record<string, unknown>;

/** Who we are, plus the three delivery tracks as an offer catalogue (home page). */
export function organizationLd(): Json {
  return {
    '@context': 'https://schema.org',
    '@type': ['Organization', 'EmploymentAgency'],
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL || undefined,
    logo: absolute('/icon.svg'),
    sameAs: SOCIAL_LINKS.map((s) => s.href),
    description: 'Talent delivery system for technical, professional and frontline roles, with verifiable Talent Passports and milestone escrow.',
    areaServed: 'Worldwide',
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Talent delivery tracks',
      itemListElement: [
        ['Technical track', 'AI/ML, engineering, cloud and data talent evaluated with sandboxed code tasks and role-fit assessments.'],
        ['Professional track', 'Product, operations and strategy roles assessed with structured AI interviews.'],
        ['Frontline & skilled track', 'Field, service and trades roles assessed by voice, in the candidate’s language.'],
      ].map(([name, description]) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name, description } })),
    },
  };
}

export function websiteLd(): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL || undefined,
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

export function faqLd(items: readonly { q: string; a: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

/** `trail` excludes Home, which is always first. The last item is the current page. */
export function breadcrumbLd(trail: readonly { name: string; path: string }[]): Json {
  const items = [{ name: 'Home', path: '/' }, ...trail];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: absolute(c.path) })),
  };
}
