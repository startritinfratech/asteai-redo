/**
 * The legal documents published under /legal. Metadata only (no document text), so the
 * footer and the index can list them cheaply. Dates for the Markdown-authored documents
 * (terms, privacy, dpa, msa) are read from the document header itself; the others carry
 * the "last updated" date their production pages showed.
 */
export type LegalSlug =
  | 'terms'
  | 'privacy'
  | 'cookies'
  | 'refunds'
  | 'cancellation'
  | 'dpa'
  | 'msa'
  | 'vendor'
  | 'do-not-sell';

export interface LegalDocMeta {
  slug: LegalSlug;
  /** The page's h1, as the production site titled it. */
  title: string;
  /** Short label for links and the <title> tag. */
  navLabel: string;
  /** One line for the /legal index and the meta description. */
  summary: string;
  /** "Last updated" for documents whose source has no Markdown header. */
  lastUpdated?: string;
}

export const LEGAL_DOCS: readonly LegalDocMeta[] = [
  {
    slug: 'terms',
    title: 'Terms and Conditions',
    navLabel: 'Terms of Service',
    summary: 'The terms that govern your use of the ASTEAI platform and services.',
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy & Compliance Framework',
    navLabel: 'Privacy Policy',
    summary: 'How ASTEAI collects, uses, discloses, stores and protects personal information.',
  },
  {
    slug: 'cookies',
    title: 'Cookie Policy',
    navLabel: 'Cookie Policy',
    summary: 'How we use cookies and similar technologies, and how you can control them.',
    lastUpdated: 'April 04, 2026',
  },
  {
    slug: 'refunds',
    title: 'Refund Policy',
    navLabel: 'Refund Policy',
    summary: 'When and how refunds are provided for services rendered through the platform.',
    lastUpdated: 'March 13, 2026',
  },
  {
    slug: 'cancellation',
    title: 'Cancellation Policy',
    navLabel: 'Cancellation Policy',
    summary: 'Cancelling projects, consultations and subscriptions on the platform.',
    lastUpdated: 'March 13, 2026',
  },
  {
    slug: 'dpa',
    title: 'Data Processing Agreement',
    navLabel: 'Data Processing Agreement',
    summary: 'How ASTEAI processes personal data on behalf of business customers.',
  },
  {
    slug: 'msa',
    title: 'Master Services Agreement',
    navLabel: 'Master Services Agreement',
    summary: 'The agreement for business and enterprise use of ASTEAI.',
  },
  {
    slug: 'vendor',
    title: 'Vendor Agreement',
    navLabel: 'Vendor Agreement',
    summary: 'The terms for individuals and entities selling services or products on the platform.',
    lastUpdated: 'October 6, 2026',
  },
  {
    slug: 'do-not-sell',
    title: 'Do Not Sell or Share My Personal Information',
    navLabel: 'Do Not Sell or Share My Info',
    summary: 'Your California privacy rights, including the right to opt out of sale or sharing.',
    lastUpdated: 'July 2, 2026',
  },
];

export function getLegalDoc(slug: LegalSlug): LegalDocMeta {
  const doc = LEGAL_DOCS.find((d) => d.slug === slug);
  if (!doc) throw new Error(`Unknown legal document: ${slug}`);
  return doc;
}
