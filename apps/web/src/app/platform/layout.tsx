import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';

/** Signed-in workspace: never indexed, and one generic title (pages are client components). */
export const metadata: Metadata = {
  title: { absolute: 'Workspace | ASTEAI' },
  robots: { index: false, follow: false },
};

/**
 * The platform shell wraps all authenticated pages.
 * Navigation rail, top bar, and main content area live here.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
