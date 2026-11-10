import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, ChatSummary } from './types';
import {
  applyMessageToList, chatTitle, formatListTime, formatMessageTime, isSendKey, markChatRead, mergeMessages, preview,
} from './thread';

const msg = (id: string, createdAt: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, chatId: 'c1', senderId: 'u2', body: id, createdAt, editedAt: null, ...over,
});

const chat = (id: string, over: Partial<ChatSummary> = {}): ChatSummary => ({
  id, type: 'direct', projectId: null, projectTitle: null,
  members: [{ id: 'u2', name: 'Ravi K', role: 'Freelancer' }],
  lastMessage: null, lastMessageAt: null, unread: 0, createdAt: '2026-11-01T00:00:00Z', ...over,
});

describe('mergeMessages', () => {
  it('dedupes by id and keeps time order', () => {
    const a = [msg('m1', '2026-11-10T09:00:00Z'), msg('m3', '2026-11-10T09:02:00Z')];
    const merged = mergeMessages(a, [msg('m2', '2026-11-10T09:01:00Z'), msg('m3', '2026-11-10T09:02:00Z', { body: 'edited' })]);
    assert.deepEqual(merged.map((m) => m.id), ['m1', 'm2', 'm3']);
    assert.equal(merged[2].body, 'edited');
  });

  it('returns the same array when there is nothing new', () => {
    const a = [msg('m1', '2026-11-10T09:00:00Z')];
    assert.equal(mergeMessages(a, []), a);
  });
});

describe('applyMessageToList', () => {
  const list = [chat('c0'), chat('c1')];

  it('moves the chat to the top, updates the preview and counts it unread', () => {
    const out = applyMessageToList(list, msg('m1', '2026-11-10T09:00:00Z', { body: 'hi\n\nthere' }), { myId: 'u1', openChatId: null });
    assert.deepEqual(out?.map((c) => c.id), ['c1', 'c0']);
    assert.equal(out?.[0].lastMessage?.body, 'hi there');
    assert.equal(out?.[0].unread, 1);
  });

  it('does not count my own messages or the open chat as unread', () => {
    assert.equal(applyMessageToList(list, msg('m1', '2026-11-10T09:00:00Z', { senderId: 'u1' }), { myId: 'u1', openChatId: null })?.[0].unread, 0);
    assert.equal(applyMessageToList(list, msg('m1', '2026-11-10T09:00:00Z'), { myId: 'u1', openChatId: 'c1' })?.[0].unread, 0);
  });

  it('asks for a refetch when the chat is new', () => {
    assert.equal(applyMessageToList(list, msg('m1', '2026-11-10T09:00:00Z', { chatId: 'c9' }), { myId: 'u1', openChatId: null }), null);
  });

  it('ignores a message older than the current preview', () => {
    const withLast = [chat('c1', { lastMessage: { body: 'new', senderId: 'u2', createdAt: '2026-11-10T10:00:00Z' } })];
    assert.equal(applyMessageToList(withLast, msg('m0', '2026-11-10T09:00:00Z'), { myId: 'u1', openChatId: null }), withLast);
  });
});

describe('helpers', () => {
  it('clears unread for one chat', () => {
    assert.deepEqual(markChatRead([chat('c1', { unread: 3 }), chat('c2', { unread: 1 })], 'c1').map((c) => c.unread), [0, 1]);
  });

  it('truncates previews', () => {
    assert.equal(preview('x'.repeat(200), 10), `${'x'.repeat(9)}…`);
  });

  it('titles a chat by its other members', () => {
    assert.equal(chatTitle({ members: [] }), 'Conversation');
    assert.equal(chatTitle(chat('c1')), 'Ravi K');
  });

  it('sends on Enter but not Shift+Enter or during IME composition', () => {
    assert.equal(isSendKey({ key: 'Enter', shiftKey: false }), true);
    assert.equal(isSendKey({ key: 'Enter', shiftKey: true }), false);
    assert.equal(isSendKey({ key: 'Enter', shiftKey: false, isComposing: true }), false);
    assert.equal(isSendKey({ key: 'a', shiftKey: false }), false);
  });

  it('formats timestamps relative to now', () => {
    const now = new Date(2026, 10, 10, 15, 0);
    assert.equal(formatMessageTime(new Date(2026, 10, 10, 9, 5).toISOString(), now), '09:05');
    assert.match(formatMessageTime(new Date(2026, 10, 8, 9, 5).toISOString(), now), /^\S+ 09:05$/);
    assert.match(formatMessageTime(new Date(2025, 0, 3, 9, 5).toISOString(), now), /2025/);
    assert.equal(formatListTime(null, now), '');
    assert.equal(formatListTime(new Date(2026, 10, 10, 9, 5).toISOString(), now), '09:05');
  });
});
