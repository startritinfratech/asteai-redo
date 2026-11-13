'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui';
import styles from './marketing.module.css';

/** Footer certification badge; opens a short explanation of the standard. */
export function IsoBadge() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={styles.isoBadge} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M8.5 12l2.5 2.5 4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        ISO 27001
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="ISO/IEC 27001:2022" size="sm"
        description="Information Security Management System (ISMS)">
        <p className={styles.lede}>
          ISO/IEC 27001:2022 is the international standard for information security management systems. It covers the
          confidentiality, integrity and availability of information through security controls, risk management and
          data-protection practices.
        </p>
      </Dialog>
    </>
  );
}
