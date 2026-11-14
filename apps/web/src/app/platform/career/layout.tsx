import { CareerTabs } from '@/features/career/CareerTabs';
import styles from '@/features/career/Career.module.css';

/** /platform/career/*: the Career Studio sections share one tab bar. */
export default function CareerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <CareerTabs />
      {children}
    </div>
  );
}
