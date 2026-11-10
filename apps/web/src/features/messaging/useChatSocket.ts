'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '@/lib/api';
import { tokenStorage } from '@/lib/tokens';
import type { ChatMessage, ChatReadEvent, ChatTypingEvent } from './types';

/** socket.io does not go through the Next.js /api rewrite, so it talks to the API host directly. */
const SOCKET_BASE = (process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001')
  .replace(/\/$/, '');

/** Give up on the socket (and let the caller poll) after this many failed attempts in a row. */
const FAILURES_BEFORE_POLLING = 3;
const TYPING_EMIT_INTERVAL_MS = 2_000;

export type ChatSocketStatus = 'connecting' | 'connected' | 'polling';

export interface ChatSocketHandlers {
  onMessage?: (message: ChatMessage) => void;
  onRead?: (event: ChatReadEvent) => void;
  onTyping?: (event: ChatTypingEvent) => void;
  /** Called after a reconnect, so the caller can refetch anything it missed. */
  onReconnect?: () => void;
}

/**
 * One socket.io connection to the `/chats` namespace for the lifetime of the component.
 *
 * - The access token goes in `auth` (read fresh on every connect attempt), never the URL.
 * - When the server rejects the token (expired) or drops the socket at token expiry,
 *   an authenticated API call lets the API client refresh the tokens, then it reconnects.
 * - Handlers are read through a ref, so changing them never re-subscribes; every
 *   listener and timer is removed in the effect cleanup.
 * - After repeated failures `status` becomes 'polling' and the caller should poll.
 */
export function useChatSocket(handlers: ChatSocketHandlers, enabled = true) {
  const [status, setStatus] = useState<ChatSocketStatus>('connecting');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const socketRef = useRef<Socket | null>(null);
  const lastTypingRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let cancelled = false;
    let failures = 0;
    let everConnected = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const socket = io(`${SOCKET_BASE}/chats`, {
      auth: (cb) => cb({ token: tokenStorage.getAccessToken() ?? '' }),
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
    });
    socketRef.current = socket;

    const scheduleReconnect = (ms: number) => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!cancelled && !socket.connected) socket.connect();
      }, ms);
    };

    /** Lets the API client refresh an expired access token, then reconnects with the new one. */
    const refreshAndReconnect = async () => {
      const before = tokenStorage.getAccessToken();
      try {
        await api.get('/users/me');
      } catch {
        // Signed out or offline: polling (and the session-expired handler) take over.
      }
      if (cancelled || !tokenStorage.getAccessToken()) return;
      const refreshed = tokenStorage.getAccessToken() !== before;
      scheduleReconnect(refreshed ? 0 : Math.min(30_000, 2_000 * 2 ** Math.min(failures, 4)));
    };

    const onConnect = () => {
      failures = 0;
      setStatus('connected');
      if (everConnected) handlersRef.current.onReconnect?.();
      everConnected = true;
    };

    const onConnectError = (err: Error) => {
      failures += 1;
      if (failures >= FAILURES_BEFORE_POLLING) setStatus('polling');
      // Middleware rejections are not retried by socket.io itself.
      if (err.message === 'unauthorized') void refreshAndReconnect();
    };

    const onDisconnect = (reason: Socket.DisconnectReason) => {
      if (cancelled) return;
      setStatus('connecting');
      // The server closes the socket when the token expires; reconnect with a fresh one.
      if (reason === 'io server disconnect') void refreshAndReconnect();
    };

    const onMessage = (m: ChatMessage) => handlersRef.current.onMessage?.(m);
    const onRead = (e: ChatReadEvent) => handlersRef.current.onRead?.(e);
    const onTyping = (e: ChatTypingEvent) => handlersRef.current.onTyping?.(e);

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    socket.on('message', onMessage);
    socket.on('read', onRead);
    socket.on('typing', onTyping);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      socket.off('message', onMessage);
      socket.off('read', onRead);
      socket.off('typing', onTyping);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled]);

  /** Tells the chat you're typing (at most every 2s per chat). */
  const emitTyping = useCallback((chatId: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    const now = Date.now();
    if (now - (lastTypingRef.current.get(chatId) ?? 0) < TYPING_EMIT_INTERVAL_MS) return;
    lastTypingRef.current.set(chatId, now);
    socket.emit('typing', { chatId });
  }, []);

  return { status, emitTyping };
}
