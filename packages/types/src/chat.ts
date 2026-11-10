// ─── Messaging ───────────────────────────────────────────────────────────────
// Shared by apps/api (modules/chats) and apps/web (features/messaging).
// Type-only, plus the const arrays the API validates against.

import type { UserRole } from './index';

export const CHAT_TYPES = ['direct', 'project', 'support'] as const;
export type ChatType = typeof CHAT_TYPES[number];

/** Longest message body the API accepts (after trimming). */
export const MESSAGE_MAX_LENGTH = 4000;

/** What a circumvention check matched. The message is still delivered. */
export const CIRCUMVENTION_PATTERNS = ['email', 'phone', 'pay_outside', 'whatsapp', 'telegram', 'upi'] as const;
export type CircumventionPattern = typeof CIRCUMVENTION_PATTERNS[number];

export interface ChatMember {
  id: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
}

/** A chat as listed by GET /chats, from the signed-in user's side. */
export interface ChatSummary {
  id: string;
  type: ChatType;
  projectId: string | null;
  projectTitle: string | null;
  /** Everyone in the chat except the caller. */
  members: ChatMember[];
  lastMessage: { body: string; senderId: string | null; createdAt: string } | null;
  lastMessageAt: string | null;
  unread: number;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

/** GET /chats/:id/messages — newest page first in time order (oldest → newest). */
export interface ChatMessagePage {
  messages: ChatMessage[];
  /** Pass as `before` to load the next older page; null when there are no older messages. */
  nextBefore: string | null;
}

/** POST /chats/:id/messages response. */
export interface SendMessageResult {
  message: ChatMessage;
  /** Set when the message looked like an attempt to move off the platform. */
  warning?: string;
}

// ─── Realtime (socket.io) events ─────────────────────────────────────────────

export interface ChatReadEvent {
  chatId: string;
  userId: string;
  readAt: string;
}

export interface ChatTypingEvent {
  chatId: string;
  userId: string;
}
