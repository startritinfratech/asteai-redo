import { HireTabs } from '@/features/hire/HireTabs';
import styles from '@/features/hire/Hire.module.css';

/** /platform/hire/*: the Company/Admin hiring workspace. */
export default function HireLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <HireTabs />
      {children}
    </div>
  );
}
