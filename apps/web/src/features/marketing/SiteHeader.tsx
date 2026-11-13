import { ThemeToggle } from '@/components/ui';
import { HeaderActions } from './AuthAwareActions';
import { Logo } from './Logo';
import { DesktopNav, MobileNav } from './MegaNav';
import styles from './marketing.module.css';

/**
 * Sticky header: logo, the audience mega-menus (from 1040px), theme toggle and account
 * actions. Below 1040px the menus move into a slide-in drawer behind the menu button.
 */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <div className={`${styles.container} ${styles.headerInner}`}>
        <Logo />
        <DesktopNav />
        <div className={styles.headerActions}>
          <span className={styles.desktopOnly}>
            <ThemeToggle />
          </span>
          <span className={styles.accountActions}>
            <HeaderActions />
          </span>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
