import type { Metadata } from 'next';
import { Sora, Manrope, JetBrains_Mono } from 'next/font/google';
import { VoiceControl } from '@/components/voice/VoiceControl';
import '@/styles/globals.css';

const sora = Sora({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
});

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'AsteAI Platform',
  description: 'AI-powered hiring and talent marketplace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${manrope.variable} ${mono.variable}`}>
      <body>
        {children}
        <VoiceControl />
      </body>
    </html>
  );
}
