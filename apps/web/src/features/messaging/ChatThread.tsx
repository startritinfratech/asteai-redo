'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { chatsApi } from './api';
import type { ChatBus } from './bus';
import type { ChatMessage, ChatSummary } from './types';
import { MESSAGE_MAX_LENGTH } from './types';
import { chatTitle, formatMessageTime, isSendKey, mergeMessages } from './thread';
import styles from './Messages.module.css';

const POLL_MS = 15_000;
const TYPING_SHOWN_MS = 4_000;
const NEAR_BOTTOM_PX = 120;

type ScrollIntent = { kind: 'bottom' } | { kind: 'keep'; prevHeight: number; prevTop: number } | null;

export function ChatThread({
  chat, myId, bus, polling, emitTyping, onBack, onSent, onRead,
}: {
  chat: ChatSummary;
  myId: string | undefined;
  bus: ChatBus;
  polling: boolean;
  emitTyping: (chatId: string) => void;
  onBack: () => void;
  onSent: (message: ChatMessage) => void;
  onRead: (chatId: string) => void;
}) {
  const chatId = chat.id;
  const title = chatTitle(chat);
  const inputId = useId();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [typingUntil, setTypingUntil] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  const scrollerRef = useRef<HTMLDivElement>(null);
  const olderRef = useRef<HTMLButtonElement>(null);
  const scrollIntent = useRef<ScrollIntent>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const nearBottom = () => {
    const el = scrollerRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  const markRead = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    onReadRef.current(chatId);
    chatsApi.read(chatId).catch(() => undefined);
  }, [chatId]);

  // ── First page whenever the chat changes ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setNextBefore(null);
    setLoading(true);
    setLoadError(null);
    setWarning(null);
    setSendError(null);
    setTypingUntil(0);
    chatsApi.messages(chatId)
      .then((page) => {
        if (cancelled) return;
        scrollIntent.current = { kind: 'bottom' };
        setMessages(page.messages);
        setNextBefore(page.nextBefore);
        markRead();
      })
      .catch((err) => { if (!cancelled) setLoadError(errorMessage(err, 'Could not load messages')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chatId, markRead]);

  /** Pulls the newest page and merges it (socket reconnects and the polling fallback). */
  const resync = useCallback(async () => {
    try {
      const page = await chatsApi.messages(chatId);
      if (nearBottom()) scrollIntent.current = { kind: 'bottom' };
      setMessages((cur) => mergeMessages(cur, page.messages));
    } catch {
      // Keep what we have; the next poll or reconnect tries again.
    }
  }, [chatId]);

  // ── Realtime events for this chat ─────────────────────────────────────────
  useEffect(() => bus.subscribe((e) => {
    if (e.kind === 'resync') { void resync(); return; }
    if (e.kind === 'typing') {
      if (e.event.chatId === chatId && e.event.userId !== myId) setTypingUntil(Date.now() + TYPING_SHOWN_MS);
      return;
    }
    if (e.kind !== 'message' || e.message.chatId !== chatId) return;
    const m = e.message;
    if (m.senderId === myId || nearBottom()) scrollIntent.current = { kind: 'bottom' };
    setMessages((cur) => mergeMessages(cur, [m]));
    if (m.senderId !== myId) {
      setTypingUntil(0);
      const from = chat.members.find((x) => x.id === m.senderId)?.name ?? 'Someone';
      setAnnouncement(`New message from ${from}: ${m.body.slice(0, 200)}`);
      markRead();
    }
  }), [bus, chatId, myId, chat.members, markRead, resync]);

  // ── Polling fallback when the socket is unavailable ───────────────────────
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => { void resync(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, resync]);

  // Hide the typing indicator when it goes stale.
  useEffect(() => {
    if (!typingUntil) return;
    const timer = setTimeout(() => setTypingUntil(0), Math.max(0, typingUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [typingUntil]);

  // ── Scroll: stick to the bottom for new messages, hold position for older ones ──
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const intent = scrollIntent.current;
    scrollIntent.current = null;
    if (!el || !intent) return;
    if (intent.kind === 'bottom') el.scrollTop = el.scrollHeight;
    else el.scrollTop = intent.prevTop + (el.scrollHeight - intent.prevHeight);
  }, [messages]);

  const loadOlder = useCallback(async () => {
    if (!nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await chatsApi.messages(chatId, nextBefore);
      const el = scrollerRef.current;
      if (el) scrollIntent.current = { kind: 'keep', prevHeight: el.scrollHeight, prevTop: el.scrollTop };
      setMessages((cur) => mergeMessages(cur, page.messages));
      setNextBefore(page.nextBefore);
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load older messages'));
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, nextBefore, loadingOlder]);

  // Infinite scroll: load older when the top of the thread comes into view.
  useEffect(() => {
    const target = olderRef.current;
    const root = scrollerRef.current;
    if (!target || !root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadOlder();
    }, { root, rootMargin: '80px 0px 0px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadOlder, nextBefore]);

  // ── Sending ───────────────────────────────────────────────────────────────
  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await chatsApi.send(chatId, body);
      scrollIntent.current = { kind: 'bottom' };
      setMessages((cur) => mergeMessages(cur, [res.message]));
      setDraft('');
      setWarning(res.warning ?? null);
      onSent(res.message);
    } catch (err) {
      setSendError(errorMessage(err, 'Message not sent. Try again.'));
    } finally {
      setSending(false);
    }
  };

  const tooLong = draft.trim().length > MESSAGE_MAX_LENGTH;
  const typingName = chat.members.length === 1 ? chat.members[0].name : 'Someone';
  const sub = [
    chat.projectTitle ? `Project: ${chat.projectTitle}` : null,
    chat.members.map((m) => m.role).join(', '),
  ].filter(Boolean).join(' · ');

  return (
    <section className={styles.threadPane} aria-label={`Conversation with ${title}`}>
      <header className={styles.paneHead}>
        <button type="button" className={styles.back} onClick={onBack}>← Chats</button>
        <div className={styles.threadTitle}>
          <h2>{title}</h2>
          {sub && <div className={styles.threadSub}>{sub}</div>}
        </div>
      </header>

      <div className={styles.scroller} ref={scrollerRef}>
        {nextBefore && (
          <button type="button" ref={olderRef} className={styles.older} onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {loading && <p className={styles.note}>Loading messages…</p>}
        {loadError && <p className={`${styles.note} ${styles.error}`} role="alert">{loadError}</p>}
        {!loading && !loadError && messages.length === 0 && (
          <p className={styles.note}>No messages yet. Say hello to {title}.</p>
        )}
        {messages.length > 0 && (
          <ol className={styles.messages} aria-label="Messages">
            {messages.map((m) => {
              const mine = m.senderId === myId;
              return (
                <li key={m.id} className={styles.message} data-mine={mine}>
                  <span className={styles.srOnly}>{mine ? 'You' : chat.members.find((x) => x.id === m.senderId)?.name ?? 'Them'}: </span>
                  <div className={styles.body}>{m.body}</div>
                  <time className={styles.meta} dateTime={m.createdAt}>
                    {formatMessageTime(m.createdAt)}{m.editedAt ? ' · edited' : ''}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className={styles.srOnly} aria-live="polite" aria-atomic="true">{announcement}</div>
      <div className={styles.typing} aria-live="off">
        {typingUntil > 0 ? `${typingName} is typing…` : ''}
      </div>

      {warning && (
        <div className={styles.warning} role="alert">
          <p>{warning}</p>
          <button type="button" className={styles.dismiss} onClick={() => setWarning(null)}>Dismiss</button>
        </div>
      )}
      {sendError && <div className={styles.composerError} role="alert">{sendError}</div>}
      {draft.length > MESSAGE_MAX_LENGTH - 400 && (
        <div className={styles.counter} aria-live="polite">{draft.trim().length} / {MESSAGE_MAX_LENGTH}</div>
      )}

      <form
        className={styles.composer}
        onSubmit={(e) => { e.preventDefault(); void send(); }}
      >
        <label htmlFor={inputId} className={styles.srOnly}>Message {title}</label>
        <textarea
          id={inputId}
          className={styles.input}
          rows={1}
          value={draft}
          readOnly={sending}
          aria-busy={sending}
          maxLength={MESSAGE_MAX_LENGTH + 200}
          placeholder={`Message ${title}…  (Enter to send, Shift+Enter for a new line)`}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim()) emitTyping(chatId);
          }}
          onKeyDown={(e) => {
            if (isSendKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className={styles.send} disabled={sending || !draft.trim() || tooLong}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
