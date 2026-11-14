'use client';

import { useEffect, useState } from 'react';
import styles from './Passport.module.css';

/** Copy link / native share for the public passport. */
export function ShareActions({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  // Read after mount: the server render can't know, and must match the first client render.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === 'function'), []);
  const url = () => window.location.href;

  return (
    <div className={styles.share}>
      <button
        type="button"
        className={styles.shareBtn}
        onClick={() => {
          void navigator.clipboard?.writeText(url()).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      {canShare && (
        <button type="button" className={styles.shareBtn} onClick={() => { void navigator.share({ title, url: url() }).catch(() => undefined); }}>
          Share…
        </button>
      )}
      <span className={styles.muted} aria-live="polite">{copied ? 'Copied to the clipboard.' : ''}</span>
    </div>
  );
}
