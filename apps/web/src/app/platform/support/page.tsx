'use client';

import { Suspense } from 'react';
import { HelpDesk } from '@/features/support/HelpDesk';

export default function SupportPage() {
  // useSearchParams (?ticket=) needs a Suspense boundary.
  return (
    <Suspense>
      <HelpDesk />
    </Suspense>
  );
}
