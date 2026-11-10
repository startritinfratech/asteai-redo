import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmail } from './VerifyEmail';

export const metadata: Metadata = {
  title: 'Confirm your email',
  robots: { index: false },
  referrer: 'no-referrer',
};

export default function VerifyEmailPage() {
  // useSearchParams (for ?token=) needs a Suspense boundary.
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
