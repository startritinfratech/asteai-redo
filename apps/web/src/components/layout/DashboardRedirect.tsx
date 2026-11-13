'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { ROLE_HOME } from '@/lib/routes';

/** /platform → the signed-in role's home page. Rendered inside AppShell, so `user` is set. */
export function DashboardRedirect() {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    if (role) router.replace(ROLE_HOME[role]);
  }, [role, router]);

  return null;
}
