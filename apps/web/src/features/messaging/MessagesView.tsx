'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { errorMessage, fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { CHATS_KEY, chatsApi } from './api';
import { createChatBus } from './bus';
import { ChatList } from './ChatList';
import { ChatThread } from './ChatThread';
import { applyMessageToList, markChatRead } from './thread';
import type { ChatMessage, ChatSummary } from './types';
import { useChatSocket } from './useChatSocket';
import styles from './Messages.module.css';

const POLL_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_LABEL = { connecting: 'Connecting…', connected: 'Live', polling: 'Offline · refreshing every 15s' } as const;

/**
 * Two-pane messaging page (list + thread; one pane at a time under 860px).
 *
 * URL state: `?chat=<id>` opens a chat; `?with=<userId>&project=<id>` starts (or
 * finds) a chat with that person and then switches to `?chat=`.
 */
export function MessagesView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const myId = useAuthStore((s) => s.user?.id);
  const selectedId = params.get('chat');
  const withUser = params.get('with');
  const withProject = params.get('project') ?? undefined;

  const [bus] = useState(createChatBus);
  const [startError, setStartError] = useState<string | null>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const chatsRef = useRef<ChatSummary[] | undefined>(undefined);

  const { status, emitTyping } = useChatSocket({
    onMessage: (m) => {
      bus.emit({ kind: 'message', message: m });
      if (!chatsRef.current?.some((c) => c.id === m.chatId)) {
        void mutate(); // a chat we have not seen yet: refetch the list
        return;
      }
      void mutate((cur) => (cur ? applyMessageToList(cur, m, { myId, openChatId: selectedRef.current }) ?? cur : cur),
        { revalidate: false });
    },
    onRead: (e) => {
      bus.emit({ kind: 'read', event: e });
      // Read in another tab or device.
      if (e.userId === myId) void mutate((cur) => (cur ? markChatRead(cur, e.chatId) : cur), { revalidate: false });
    },
    onTyping: (e) => bus.emit({ kind: 'typing', event: e }),
    onReconnect: () => {
      bus.emit({ kind: 'resync' });
      void mutate();
    },
  }, Boolean(myId));

  const { data: chats, error, isLoading, mutate } = useSWR<ChatSummary[]>(CHATS_KEY, fetcher, {
    refreshInterval: status === 'polling' ? POLL_MS : 0,
  });
  chatsRef.current = chats;

  const open = useCallback((chatId: string | null) => {
    router.push(chatId ? `${pathname}?chat=${encodeURIComponent(chatId)}` : pathname, { scroll: false });
  }, [router, pathname]);

  // ── ?with=<userId>&project=<id>: start or find the chat, then open it ─────
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!withUser || !myId) return;
    const key = `${withUser}|${withProject ?? ''}`;
    if (startedFor.current === key) return;
    startedFor.current = key;
    if (!UUID.test(withUser)) {
      setStartError('That link does not point to a valid person.');
      return;
    }
    setStartError(null);
    chatsApi.start(withUser, withProject)
      .then((chat) => {
        void mutate((cur) => (cur?.some((c) => c.id === chat.id) ? cur : [chat, ...(cur ?? [])]), { revalidate: false });
        router.replace(`${pathname}?chat=${encodeURIComponent(chat.id)}`, { scroll: false });
      })
      .catch((err) => setStartError(errorMessage(err, 'Could not start the conversation')));
  }, [withUser, withProject, myId, mutate, router, pathname]);

  const onSent = useCallback((m: ChatMessage) => {
    void mutate((cur) => (cur ? applyMessageToList(cur, m, { myId, openChatId: m.chatId }) ?? cur : cur), { revalidate: false });
  }, [mutate, myId]);

  const onRead = useCallback((chatId: string) => {
    void mutate((cur) => (cur ? markChatRead(cur, chatId) : cur), { revalidate: false });
  }, [mutate]);

  const selected = chats?.find((c) => c.id === selectedId) ?? null;
  const unknownChat = Boolean(selectedId && chats && !selected);

  return (
    <div className={styles.root} data-view={selectedId ? 'thread' : 'list'}>
      <nav className={styles.listPane} aria-label="Conversations">
        <div className={styles.paneHead}>
          <h2>Messages</h2>
          <span className={styles.status} data-status={status} role="status">{STATUS_LABEL[status]}</span>
        </div>
        {startError && <p className={`${styles.note} ${styles.error}`} role="alert">{startError}</p>}
        {isLoading && <p className={styles.note}>Loading conversations…</p>}
        {error && !chats && (
          <p className={`${styles.note} ${styles.error}`} role="alert">
            {errorMessage(error, 'Could not load conversations.')}{' '}
            <button type="button" className={styles.dismiss} onClick={() => void mutate()}>Retry</button>
          </p>
        )}
        {chats && chats.length === 0 && !withUser && (
          <p className={styles.note}>
            No conversations yet. You can message people you work with: the buyer or freelancer on a project,
            an employer you applied to, or AsteAI support.
          </p>
        )}
        {chats && chats.length > 0 && (
          <ChatList chats={chats} selectedId={selectedId} myId={myId} onSelect={open} />
        )}
      </nav>

      {selected ? (
        <ChatThread
          key={selected.id}
          chat={selected}
          myId={myId}
          bus={bus}
          polling={status === 'polling'}
          emitTyping={emitTyping}
          onBack={() => open(null)}
          onSent={onSent}
          onRead={onRead}
        />
      ) : (
        <section className={styles.threadPane} aria-label="Conversation">
          {selectedId && (
            <header className={styles.paneHead}>
              <button type="button" className={styles.back} onClick={() => open(null)}>← Chats</button>
            </header>
          )}
          <div className={styles.emptyThread}>
            {unknownChat
              ? <p role="alert">This conversation does not exist or you are not part of it.</p>
              : selectedId && !chats
                ? <p>Loading…</p>
                : <p>Select a conversation to start messaging.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
