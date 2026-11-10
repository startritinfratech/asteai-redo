import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetForm } from './ResetForm';

export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false },
  // Keep the token in the URL from leaking to other sites through the Referer header.
  referrer: 'no-referrer',
};

export default function ResetPasswordPage() {
  // useSearchParams (for ?token=) needs a Suspense boundary.
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
