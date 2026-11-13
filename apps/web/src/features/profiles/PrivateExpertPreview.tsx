'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { ExpertProfileView } from './ExpertProfileView';
import type { ExpertDetail } from './types';
import styles from './profiles.module.css';

/**
 * Shown when the server found no public profile. The owner or an admin may still be
 * allowed to see it (draft / pending / rework), so retry with their token; everyone
 * else gets "not found".
 */
export function PrivateExpertPreview({ id }: { id: string }) {
  const hydrated = useAuthHydrated();
  const user = useAuthStore((s) => s.user);
  const mayPreview = hydrated && user !== null && (user.id === id || user.role === 'Admin');
  const { data, isLoading } = useSWR<ExpertDetail>(mayPreview ? `/experts/${id}` : null, fetcher);

  if (data) return <ExpertProfileView expert={data} />;
  if (!hydrated || isLoading) return <p className={styles.muted} style={{ paddingBlock: 40 }}>Loading…</p>;
  return (
    <div className={styles.emptyBox} style={{ marginBlock: 40 }}>
      <p>This expert profile doesn’t exist or isn’t public.</p>
      <p style={{ marginTop: 10 }}><Link href="/experts">Browse all experts</Link></p>
    </div>
  );
}
