'use client';

import { useEffect, useState } from 'react';

/**
 * False during server render and the first client render, true once React has hydrated.
 * Public forms keep their submit button disabled until then: a click before hydration
 * would otherwise do a native form submit and put the fields (email, message) in the URL.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
