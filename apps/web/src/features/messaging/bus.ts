import type { ChatMessage, ChatReadEvent, ChatTypingEvent } from './types';

export type ChatEvent =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'read'; event: ChatReadEvent }
  | { kind: 'typing'; event: ChatTypingEvent }
  | { kind: 'resync' };

/** Fan-out from the one socket to whichever thread is open. Every event is delivered (no batching). */
export function createChatBus() {
  const listeners = new Set<(e: ChatEvent) => void>();
  return {
    emit(e: ChatEvent) {
      listeners.forEach((fn) => fn(e));
    },
    subscribe(fn: (e: ChatEvent) => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export type ChatBus = ReturnType<typeof createChatBus>;
