import type { Metadata } from 'next';
import { VerifyCertificate } from './VerifyCertificate';

/**
 * Where a certificate's "Verified online at" link lands. Shareable, but not indexed:
 * each page names a person, and search engines don't need a copy of that.
 */
export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  return {
    title: 'Certificate check',
    description: 'Check that an ASTEAI certificate is genuine.',
    alternates: { canonical: `/verify/certificate/${encodeURIComponent(params.id)}` },
    robots: { index: false, follow: false },
  };
}

export default function VerifyCertificatePage() {
  return <VerifyCertificate />;
}
