/**
 * Pure helpers for the messaging UI: merging pages and realtime events, updating the
 * chat list, and formatting timestamps. Kept free of React so they can be unit tested.
 */
import type { ChatMessage, ChatSummary } from './types';

const byTime = (a: ChatMessage, b: ChatMessage) =>
  a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? -1 : 1;

/** Union of two message lists by id (later copies win), oldest first. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return current;
  const map = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return Array.from(map.values()).sort(byTime);
}

/**
 * Applies a new message to the chat list: updates the preview, bumps the chat to the
 * top and counts it as unread unless it is mine or the chat is open.
 * Returns null when the chat is not in the list (the caller should refetch).
 */
export function applyMessageToList(
  chats: ChatSummary[],
  message: ChatMessage,
  opts: { myId: string | undefined; openChatId: string | null },
): ChatSummary[] | null {
  const index = chats.findIndex((c) => c.id === message.chatId);
  if (index < 0) return null;
  const chat = chats[index];
  if (chat.lastMessage && chat.lastMessage.createdAt > message.createdAt) return chats;
  const counts = message.senderId !== opts.myId && opts.openChatId !== message.chatId;
  const updated: ChatSummary = {
    ...chat,
    lastMessage: { body: preview(message.body), senderId: message.senderId, createdAt: message.createdAt },
    lastMessageAt: message.createdAt,
    unread: counts ? chat.unread + 1 : chat.unread,
  };
  return [updated, ...chats.slice(0, index), ...chats.slice(index + 1)];
}

export function markChatRead(chats: ChatSummary[], chatId: string): ChatSummary[] {
  return chats.map((c) => (c.id === chatId && c.unread ? { ...c, unread: 0 } : c));
}

export function preview(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** "Ravi K", "Ravi K, Asha R" — the other people in a chat. */
export function chatTitle(chat: Pick<ChatSummary, 'members'>): string {
  return chat.members.map((m) => m.name).join(', ') || 'Conversation';
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Time on a message bubble: "14:05" today, "Mon 14:05" this week, "3 Oct 14:05" older. */
export function formatMessageTime(iso: string, now = new Date(), locale = 'en-IN'): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (sameDay(d, now)) return time;
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days >= 0 && days < 6) return `${d.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString(locale, opts)} ${time}`;
}

/** Short stamp for the chat list: "14:05", "Mon", "3 Oct". */
export function formatListTime(iso: string | null, now = new Date(), locale = 'en-IN'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (sameDay(d, now)) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days >= 0 && days < 6) return d.toLocaleDateString(locale, { weekday: 'short' });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/** True when the composer should send: Enter without Shift, and not mid IME composition. */
export function isSendKey(e: { key: string; shiftKey: boolean; isComposing?: boolean }): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.isComposing;
}
