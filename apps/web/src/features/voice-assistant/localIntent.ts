import type { VoiceCommandResult, VoiceTarget } from '@asteai/types';

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Label without a leading "my" / "the", so "open applications" finds "My Applications". */
const bare = (s: string) => norm(s).replace(/^(?:my|the) /, '');
const routeAliases: Readonly<Record<string, string>> = {
  'job creator': 'route:hire/job-creator',
  'create a job': 'route:hire/job-creator',
  'post a job': 'route:hire/job-creator',
  'interview studio': 'route:studio',
  'pipeline': 'route:pipeline',
  'talent pool': 'route:pools',
  'talent pools': 'route:pools',
  'support': 'route:support',
  'talk to a human': 'route:support',
  'speak to a human': 'route:support',
  'talk to someone': 'route:support',
  'speak to someone': 'route:support',
  'get human support': 'route:support',
};
const actionAliases: Readonly<Record<string, string>> = { 'generate job': 'action:job-creator.generate' };
const smallNumbers = 'zero one two three four five six seven eight nine ten eleven twelve'.split(' ');

export function spokenInteger(value = '') {
  const text = value.trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  return smallNumbers.indexOf(text);
}

export function confirmationReply(utterance: string): 'confirm' | 'cancel' | null {
  const text = norm(utterance);
  if (text === 'confirm' || text === 'yes confirm' || text === 'yes do it') return 'confirm';
  if (text === 'cancel' || text === 'never mind' || text === 'no') return 'cancel';
  return null;
}

const result = (r: Partial<VoiceCommandResult> & Pick<VoiceCommandResult, 'kind' | 'speech'>): VoiceCommandResult => ({
  targetId: null, value: null, needsConfirmation: false, ...r,
});

/**
 * Handles the common, unambiguous English commands without a model call:
 * "back", "scroll down", "open requisitions", "press new requisition".
 * Returns null when it isn't sure, and the command goes to the server.
 */
export function matchLocally(utterance: string, targets: VoiceTarget[], followUp = false): VoiceCommandResult | null {
  const text = utterance.trim().replace(/^(?:(?:hey aste\s*ai|please|can you|could you|i want to|i need to)[,\s]+)+/i, '');
  const u = norm(text);
  if (/^(go )?back$/.test(u)) return result({ kind: 'back', speech: 'Going back.' });
  const support = targets.find((target) => target.id === 'route:support' && target.kind === 'route');
  if (support && /^(?:i (?:am|m) (?:stuck|frustrated)|this is (?:frustrating|not working)|nothing (?:is working|works))$/.test(u)) {
    return result({
      kind: 'clarify',
      speech: 'I can help. What were you trying to do? You can also say “talk to a human” to open Help & Support.',
    });
  }
  if (/^(?:where can i (?:see|find)|show me) (?:my )?candidates$/.test(u) &&
      targets.some((t) => t.id === 'route:pipeline') && targets.some((t) => t.id === 'route:pools')) {
    return result({ kind: 'clarify', speech: 'Do you mean the applications pipeline or the talent pool?' });
  }

  const scroll = /^scroll (up|down)$/.exec(u);
  if (scroll) return result({ kind: 'scroll', value: scroll[1], speech: '' });

  const fill = /^(?:set|change|fill|choose)\s+(.+?)\s+(?:to|with)\s+([\s\S]+)$/i.exec(text);
  if (fill) {
    const hits = targets.filter((t) => t.kind === 'field' && bare(t.label) === bare(fill[1]));
    if (hits.length !== 1) return null;
    const [t] = hits;
    return result({ kind: 'fill', targetId: t.id, value: fill[2], speech: `Updated ${t.label}.`, needsConfirmation: t.confirm === true });
  }

  const verb = /^(?:go to|open|show(?: me)?|take me to|navigate to|press|click|tap)\s+(.+?)(?: page)?$/.exec(u);
  const wanted = bare(verb?.[1] ?? u);
  const alias = routeAliases[wanted];
  const actionAlias = actionAliases[wanted];
  if (!verb && !followUp && !Object.hasOwn(routeAliases, wanted) && !Object.hasOwn(actionAliases, wanted)) return null;
  // A short clarification answer can safely select a route. Action commands still need an explicit verb.
  const hits = targets.filter((t) => t.kind === 'route'
    ? (bare(t.label) === wanted || t.id === alias)
    : t.kind === 'action' && ((!!verb && bare(t.label) === wanted) || t.id === actionAlias));
  if (hits.length !== 1) return null;

  const [t] = hits;
  return result({
    kind: t.kind === 'route' ? 'navigate' : 'invoke',
    targetId: t.id,
    speech: t.kind === 'route' ? `Opening ${t.label}.` : `${t.label}.`,
    needsConfirmation: t.confirm === true,
  });
}
