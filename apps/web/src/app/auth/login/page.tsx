import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to AsteAI to manage hiring, assessments, your Talent Passport and escrow projects.',
  alternates: { canonical: '/auth/login' },
};

export default function LoginPage() {
  // useSearchParams (for ?next=) needs a Suspense boundary.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
