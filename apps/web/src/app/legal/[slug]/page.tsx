import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LEGAL_DOCS, type LegalSlug } from '@/features/marketing/legal/documents';
import { LegalDocument, legalMetadata } from '@/features/marketing/legal/LegalDocument';

/** Only the published documents exist; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_DOCS.map((d) => ({ slug: d.slug }));
}

function isSlug(slug: string): slug is LegalSlug {
  return LEGAL_DOCS.some((d) => d.slug === slug);
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  return isSlug(params.slug) ? legalMetadata(params.slug) : {};
}

export default function LegalPage({ params }: { params: { slug: string } }) {
  if (!isSlug(params.slug)) notFound();
  return <LegalDocument slug={params.slug} />;
}
