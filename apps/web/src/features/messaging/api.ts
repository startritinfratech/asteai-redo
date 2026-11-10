import { api } from '@/lib/api';
import type { ChatMessagePage, ChatSummary, SendMessageResult } from './types';

export const CHATS_KEY = '/chats';

export const chatsApi = {
  list: () => api.get<ChatSummary[]>(CHATS_KEY),
  start: (userId: string, projectId?: string) =>
    api.post<ChatSummary>(CHATS_KEY, projectId ? { userId, projectId } : { userId }),
  messages: (chatId: string, before?: string, limit = 30) =>
    api.get<ChatMessagePage>(`/chats/${encodeURIComponent(chatId)}/messages`, { before, limit }),
  send: (chatId: string, body: string) =>
    api.post<SendMessageResult>(`/chats/${encodeURIComponent(chatId)}/messages`, { body }),
  read: (chatId: string) => api.post<{ chatId: string; readAt: string }>(`/chats/${encodeURIComponent(chatId)}/read`),
};
