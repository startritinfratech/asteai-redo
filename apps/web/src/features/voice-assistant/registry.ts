'use client';

import { useEffect, useRef } from 'react';
import type { VoiceTarget } from '@asteai/types';

/** A target plus what to do when voice selects it (`value` is the text for fields). */
export interface RegisteredTarget extends VoiceTarget {
  run?: (value?: string) => void | Promise<void>;
}

const targets = new Map<string, RegisteredTarget>();

/** Every target the mounted pages registered, in registration order. */
export function pageTargets(): RegisteredTarget[] {
  return [...targets.values()];
}

/**
 * Registers a page's voice actions and fields while the component is mounted:
 *
 *   useVoiceTargets([
 *     { id: 'action:requisitions.create', kind: 'action', label: 'New Requisition', run: openForm },
 *   ]);
 *
 * Handlers are read at call time, so they may close over fresh state.
 */
export function useVoiceTargets(list: RegisteredTarget[]) {
  const latest = useRef(list);
  latest.current = list;
  const key = list.map((t) => `${t.id}|${t.label}|${t.confirm ? 1 : 0}`).join(',');

  useEffect(() => {
    const ids = latest.current.map((t) => t.id);
    latest.current.forEach((t) =>
      targets.set(t.id, { ...t, run: (value) => latest.current.find((x) => x.id === t.id)?.run?.(value) }),
    );
    return () => ids.forEach((id) => targets.delete(id));
  }, [key]);
}
