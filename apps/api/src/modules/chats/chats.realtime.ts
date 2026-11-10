import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import type { ChatMessage, ChatReadEvent } from './chat.types';

export const chatRoom = (chatId: string) => `chat:${chatId}`;
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * The service's handle on the socket.io namespace. The gateway attaches the server
 * when it starts; until then (and in unit tests) every emit is a no-op.
 *
 * Rooms live in this process's memory: with more than one API instance, install the
 * socket.io Redis adapter so an emit here reaches sockets connected to other instances.
 */
@Injectable()
export class ChatsRealtime {
  private server: Namespace | null = null;

  attach(server: Namespace) {
    this.server = server;
  }

  message(message: ChatMessage) {
    this.server?.to(chatRoom(message.chatId)).emit('message', message);
  }

  read(event: ChatReadEvent) {
    this.server?.to(chatRoom(event.chatId)).emit('read', event);
  }

  /** Puts every connected socket of these users into a chat's room (for chats created after they connected). */
  join(chatId: string, userIds: string[]) {
    this.server?.in(userIds.map(userRoom)).socketsJoin(chatRoom(chatId));
  }
}
