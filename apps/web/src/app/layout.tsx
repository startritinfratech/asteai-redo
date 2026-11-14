import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import '@/styles/globals.css';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { SITE_NAME, TWITTER_HANDLE } from '@/lib/site';

const sora = localFont({
  src: './fonts/sora.woff2',
  weight: '500 800',
  variable: '--font-sora',
});

const manrope = localFont({
  src: './fonts/manrope.woff2',
  weight: '400 700',
  variable: '--font-manrope',
});

const mono = localFont({
  src: './fonts/jetbrains-mono.woff2',
  weight: '400 600',
  variable: '--font-jetbrains',
});

const DEFAULT_DESCRIPTION =
  'ASTEAI is a talent delivery system: AI interviews, server-scored assessments, verifiable Talent Passports and escrow-protected projects across technical, professional and frontline roles.';

/**
 * Site-wide defaults. Pages set `title` (put through the template) or `title.absolute`, a
 * description and `alternates.canonical`; OG / Twitter fields fall back to these. The default
 * share image is app/opengraph-image.tsx.
 */
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'ASTEAI — Hiring, delivered', template: `%s | ${SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  formatDetection: { telephone: false },
  openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_IN', description: DEFAULT_DESCRIPTION },
  twitter: { card: 'summary_large_image', site: TWITTER_HANDLE, description: DEFAULT_DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#03010a' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set before paint by the init script, so server and client markup differ on purpose.
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${sora.variable} ${manrope.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
