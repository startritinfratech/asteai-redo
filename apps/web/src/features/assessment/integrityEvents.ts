/**
 * Integrity event counts (tab exits, pastes) are sent with each answer. The API caps
 * each count per request, so a larger backlog is sent in batches: this answer carries
 * at most MAX_EVENTS_PER_ANSWER of each, and the rest stays queued for the next one.
 */
export const MAX_EVENTS_PER_ANSWER = 50;

export interface IntegrityCounts {
  blur: number;
  paste: number;
}

const cap = (n: number) => Math.max(0, Math.min(Math.floor(n) || 0, MAX_EVENTS_PER_ANSWER));

/** The counts to send now; subtract them from the pending counts once the send succeeds. */
export function eventsToSend(pending: IntegrityCounts): IntegrityCounts {
  return { blur: cap(pending.blur), paste: cap(pending.paste) };
}

/** What remains pending after `sent` was accepted by the server. */
export function remainingEvents(pending: IntegrityCounts, sent: IntegrityCounts): IntegrityCounts {
  return { blur: Math.max(0, pending.blur - sent.blur), paste: Math.max(0, pending.paste - sent.paste) };
}
