import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterForm } from './RegisterForm';

export const metadata: Metadata = {
  title: 'Create your account',
  description:
    'Join AsteAI as an employer, candidate, expert or buyer: hire on assessed role fit, earn a verifiable Talent Passport, or run escrow-protected projects.',
  alternates: { canonical: '/auth/register' },
};

export default function RegisterPage() {
  // useSearchParams (for ?role=) needs a Suspense boundary.
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
