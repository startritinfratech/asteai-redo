import type { VoiceCommandResult, VoiceTarget } from '@asteai/types';

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Label without a leading "my" / "the", so "open applications" finds "My Applications". */
const bare = (s: string) => norm(s).replace(/^(?:my|the) /, '');

const result = (r: Partial<VoiceCommandResult> & Pick<VoiceCommandResult, 'kind' | 'speech'>): VoiceCommandResult => ({
  targetId: null, value: null, needsConfirmation: false, ...r,
});

/**
 * Handles the common, unambiguous English commands without a model call:
 * "back", "scroll down", "open requisitions", "press new requisition".
 * Returns null when it isn't sure, and the command goes to the server.
 */
export function matchLocally(utterance: string, targets: VoiceTarget[]): VoiceCommandResult | null {
  const u = norm(utterance);
  if (/^(go )?back$/.test(u)) return result({ kind: 'back', speech: 'Going back.' });

  const scroll = /^scroll (up|down)$/.exec(u);
  if (scroll) return result({ kind: 'scroll', value: scroll[1], speech: '' });

  const verb = /^(?:go to|open|show(?: me)?|take me to|navigate to|press|click|tap)\s+(.+?)(?: page)?$/.exec(u);
  if (!verb) return null;

  const wanted = bare(verb[1]);
  const hits = targets.filter((t) => t.kind !== 'field' && bare(t.label) === wanted);
  if (hits.length !== 1) return null;

  const [t] = hits;
  return result({
    kind: t.kind === 'route' ? 'navigate' : 'invoke',
    targetId: t.id,
    speech: t.kind === 'route' ? `Opening ${t.label}.` : `${t.label}.`,
    needsConfirmation: t.confirm === true,
  });
}
