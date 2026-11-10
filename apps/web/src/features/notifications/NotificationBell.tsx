'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import type { Notification } from '@asteai/types';
import { api, fetcher } from '@/lib/api';
import { isInternalLink } from './links';
import styles from './NotificationBell.module.css';

const ago = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function relative(t: number): string {
  const mins = Math.round((t - Date.now()) / 60_000);
  if (Math.abs(mins) < 60) return ago.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return ago.format(hours, 'hour');
  return ago.format(Math.round(hours / 24), 'day');
}

/** Only same-site paths are followed (the API stores '#' for anything else). */
const isInternal = (link: string) => isInternalLink(link, window.location.origin);

/** Bell with an unread count; opens a list of the user's latest notifications. */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { data, mutate } = useSWR<Notification[]>('/notifications', fetcher, { refreshInterval: 60_000 });
  const unread = data?.filter((n) => !n.read).length ?? 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openOne = async (n: Notification) => {
    if (!n.read) {
      await api.patch(`/notifications/${encodeURIComponent(n.id)}/read`).catch(() => undefined);
      void mutate();
    }
    if (isInternal(n.link)) {
      setOpen(false);
      router.push(n.link);
    }
  };

  const readAll = async () => {
    await api.patch('/notifications/read-all').catch(() => undefined);
    void mutate();
  };

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={styles.bell}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        🔔
        {unread > 0 && <span className={styles.badge} aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Notifications">
          <div className={styles.head}>
            <span>Notifications</span>
            {unread > 0 && <button type="button" className={styles.link} onClick={readAll}>Mark all read</button>}
          </div>
          {!data && <p className={styles.empty}>Loading…</p>}
          {data && data.length === 0 && <p className={styles.empty}>Nothing yet.</p>}
          {data && data.length > 0 && (
            <ul className={styles.list}>
              {data.map((n) => (
                <li key={n.id}>
                  <button type="button" className={styles.item} data-unread={!n.read} onClick={() => openOne(n)}>
                    <span className={styles.text}>{n.text}</span>
                    <span className={styles.time}>{relative(n.t)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
