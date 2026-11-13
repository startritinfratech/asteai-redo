'use client';

/**
 * Header navigation: three audience mega-menus plus plain links from 1040px up, and a
 * slide-in drawer below that. The menus are disclosure buttons (not ARIA menus) so their
 * links stay ordinary links: Tab moves through them, Esc or a click outside closes.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Dialog, ThemeToggle } from '@/components/ui';
import { HeaderActions } from './AuthAwareActions';
import { AUDIENCE_MENUS, TOP_LINKS, type AudienceMenu } from './nav';
import styles from './nav.module.css';

export function DesktopNav() {
  const [open, setOpen] = useState<AudienceMenu['id'] | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  // Close on navigation, outside click and Esc (Esc returns focus to the trigger).
  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      navRef.current?.querySelector<HTMLButtonElement>(`[data-menu="${open}"]`)?.focus();
      setOpen(null);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <nav ref={navRef} className={styles.desktop} aria-label="Main">
      <ul className={styles.topList}>
        {AUDIENCE_MENUS.map((m) => (
          <li key={m.id} className={styles.topItem}>
            <MenuTrigger menu={m} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} />
          </li>
        ))}
        {TOP_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className={clsx(styles.topLink, pathname === l.href && styles.current)} aria-current={pathname === l.href ? 'page' : undefined}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function MenuTrigger({ menu, open, onToggle }: { menu: AudienceMenu; open: boolean; onToggle: () => void }) {
  const panelId = useId();
  return (
    <>
      <button
        type="button"
        data-menu={menu.id}
        className={clsx(styles.topLink, styles.trigger, open && styles.triggerOpen)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        {menu.label}
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" className={styles.caret}>
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </button>
      <div id={panelId} className={styles.panel} hidden={!open}>
        <div className={styles.panelGrid}>
          {menu.groups.map((g) => (
            <div key={g.heading}>
              <p className={styles.groupHeading}>{g.heading}</p>
              <ul className={styles.linkList}>
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className={styles.menuLink}>
                      <span className={styles.menuLabel}>{l.label}</span>
                      <span className={styles.menuDesc}>{l.desc}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Link href={menu.overview.href} className={styles.overview}>
          {menu.overview.label} <span aria-hidden="true">→</span>
        </Link>
      </div>
    </>
  );
}

/** Hamburger + slide-in sheet, shown below 1040px. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className={styles.mobile}>
      <button
        type="button"
        className={styles.burger}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Menu" variant="sheet">
        <nav aria-label="Main" className={styles.drawerNav}>
          {AUDIENCE_MENUS.map((m) => (
            <details key={m.id} className={styles.drawerGroup}>
              <summary className={styles.drawerSummary}>
                {m.label}
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className={styles.caret}>
                  <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </summary>
              <ul className={styles.drawerList}>
                {m.groups.flatMap((g) => g.links).map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className={styles.drawerLink} onClick={() => setOpen(false)}>{l.label}</Link>
                  </li>
                ))}
                <li>
                  <Link href={m.overview.href} className={clsx(styles.drawerLink, styles.drawerOverview)} onClick={() => setOpen(false)}>
                    {m.overview.label} →
                  </Link>
                </li>
              </ul>
            </details>
          ))}
          <ul className={styles.drawerTop}>
            {TOP_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={styles.drawerSummary} onClick={() => setOpen(false)}>{l.label}</Link>
              </li>
            ))}
          </ul>
          <div className={styles.drawerFoot}>
            <HeaderActions />
            <ThemeToggle />
          </div>
        </nav>
      </Dialog>
    </div>
  );
}
