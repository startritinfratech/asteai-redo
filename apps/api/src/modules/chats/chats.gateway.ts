import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit,
  SubscribeMessage, WebSocketGateway,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import type { User } from '@asteai/types';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ACCESS_COOKIE, allowedOrigins, cookieFromHeader } from '../auth/session-cookies';
import type { ChatTypingEvent } from './chat.types';
import { ChatsService } from './chats.service';
import { ChatsRealtime, chatRoom, userRoom } from './chats.realtime';

export const CHATS_NAMESPACE = '/chats';
const TYPING_MIN_INTERVAL_MS = 1_500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SocketData {
  user: User;
  expiry?: ReturnType<typeof setTimeout>;
  lastTyping: Map<string, number>;
}

type ChatSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/**
 * Reads the access token from `handshake.auth.token`, else from the HttpOnly access cookie
 * the browser sends with the handshake (never the URL, where it would end up in logs).
 */
export function handshakeToken(
  socket: Pick<Socket, 'handshake'>,
  origins: () => readonly string[] = () => [],
): string | null {
  const explicit = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof explicit === 'string' && explicit) return explicit.length < 4096 ? explicit : null;
  // WebSocket upgrades skip CORS, so a cookie only counts from one of the web app's origins.
  const origin = socket.handshake.headers?.origin;
  if (!origin || !origins().includes(origin)) return null;
  const token = cookieFromHeader(socket.handshake.headers?.cookie, ACCESS_COOKIE);
  return typeof token === 'string' && token.length > 0 && token.length < 4096 ? token : null;
}

/**
 * Realtime side of messaging (socket.io namespace `/chats`).
 *
 * - The handshake is authenticated with the same access token and secret as the REST
 *   API's JWT strategy, and the user must still be active.
 * - Each socket joins `user:<id>` and `chat:<id>` for every chat the user is in; new
 *   chats are joined via ChatsRealtime.join().
 * - Server → client: `message`, `read`, `typing`. Client → server: `typing` only;
 *   messages are sent over REST (rate-limited, validated) and fanned out from there.
 * - The socket is closed when its token expires; the client reconnects with a fresh one.
 *
 * Throttling is skipped here (the global ThrottlerGuard assumes HTTP); typing has its own limit.
 */
@SkipThrottle()
@WebSocketGateway({ namespace: CHATS_NAMESPACE })
export class ChatsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly chats: ChatsService,
    private readonly realtime: ChatsRealtime,
  ) {}

  afterInit(server: Namespace) {
    this.realtime.attach(server);
    server.use((socket, next) => {
      this.authenticate(socket as ChatSocket)
        .then(() => next())
        .catch(() => next(new Error('unauthorized')));
    });
  }

  /** Verifies the token exactly as JwtStrategy does and loads the (still active) user. */
  async authenticate(socket: ChatSocket): Promise<void> {
    const token = handshakeToken(socket, () => allowedOrigins(this.config));
    if (!token) throw new Error('missing token');
    const payload = await this.jwt.verifyAsync<JwtPayload & { exp?: number; iat?: number; purpose?: unknown }>(token, {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
    });
    // Like JwtStrategy.validate: no special-purpose tokens (2FA challenges), and the user
    // must be active, not blocked, and not have changed the password since the token was issued.
    if (payload.purpose !== undefined || typeof payload.sub !== 'string') throw new Error('not an access token');
    const user = await this.chats.loadActiveUser(payload.sub, payload);
    if (!user) throw new Error('inactive user');
    socket.data.user = user;
    socket.data.lastTyping = new Map();
    if (payload.exp) {
      const ms = payload.exp * 1000 - Date.now();
      // setTimeout overflows above ~24.8 days; access tokens are minutes long.
      socket.data.expiry = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    }
  }

  async handleConnection(socket: ChatSocket) {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    try {
      const chatIds = await this.chats.chatIdsFor(user.id);
      await socket.join([userRoom(user.id), ...chatIds.map(chatRoom)]);
    } catch (err) {
      this.logger.error(`Could not join chat rooms for ${user.id}: ${err instanceof Error ? err.message : String(err)}`);
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: ChatSocket) {
    if (socket.data?.expiry) clearTimeout(socket.data.expiry);
    socket.data?.lastTyping?.clear();
  }

  /** Relays "is typing" to the rest of the chat. Members only (the socket must be in the room). */
  @SubscribeMessage('typing')
  typing(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    const chatId = (body as { chatId?: unknown } | null)?.chatId;
    const user = socket.data.user;
    if (!user || typeof chatId !== 'string' || !UUID.test(chatId)) return;
    const room = chatRoom(chatId);
    if (!socket.rooms.has(room)) return;
    const now = Date.now();
    if (now - (socket.data.lastTyping.get(chatId) ?? 0) < TYPING_MIN_INTERVAL_MS) return;
    socket.data.lastTyping.set(chatId, now);
    const event: ChatTypingEvent = { chatId, userId: user.id };
    socket.to(room).emit('typing', event);
  }
}
