import type { VoiceCommandResult } from '@asteai/types';
import type { RegisteredTarget } from './registry';
import { routeHref } from './routeTargets';

export interface Navigator {
  push(href: string): void;
  back(): void;
}

/**
 * Runs a resolved command. Only targets that are still registered can run, so a
 * stale or invented id does nothing. Returns false when nothing could be done.
 */
export async function execute(
  cmd: VoiceCommandResult,
  targets: RegisteredTarget[],
  nav: Navigator,
): Promise<boolean> {
  switch (cmd.kind) {
    case 'back':
      nav.back();
      return true;
    case 'scroll': {
      const main = document.querySelector('main') ?? document.scrollingElement;
      main?.scrollBy({ top: (cmd.value === 'up' ? -1 : 1) * window.innerHeight * 0.7, behavior: 'smooth' });
      return true;
    }
    case 'navigate': {
      const t = targets.find((x) => x.id === cmd.targetId && x.kind === 'route');
      if (!t) return false;
      nav.push(routeHref(t.id));
      return true;
    }
    case 'invoke':
    case 'fill': {
      const t = targets.find((x) => x.id === cmd.targetId && x.kind === (cmd.kind === 'fill' ? 'field' : 'action'));
      if (!t?.run) return false;
      await t.run(cmd.value ?? undefined);
      return true;
    }
    default:
      return true; // answer / clarify: speech only
  }
}

/** The page's own flag wins over the server's answer: confirm if either says so. */
export function needsConfirmation(cmd: VoiceCommandResult, targets: RegisteredTarget[]): boolean {
  return cmd.needsConfirmation || targets.some((t) => t.id === cmd.targetId && t.confirm);
}
