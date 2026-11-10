'use client';

import type { ChatSummary } from './types';
import { chatTitle, formatListTime } from './thread';
import styles from './Messages.module.css';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

export function ChatList({
  chats, selectedId, myId, onSelect,
}: {
  chats: ChatSummary[];
  selectedId: string | null;
  myId: string | undefined;
  onSelect: (chatId: string) => void;
}) {
  return (
    <ul className={styles.list}>
      {chats.map((chat) => {
        const title = chatTitle(chat);
        const last = chat.lastMessage;
        const mine = last && last.senderId === myId;
        const label = `${title}${chat.unread ? `, ${chat.unread} unread` : ''}`;
        return (
          <li key={chat.id}>
            <button
              type="button"
              className={styles.chatItem}
              aria-current={chat.id === selectedId ? 'true' : undefined}
              aria-label={label}
              data-unread={chat.unread > 0}
              onClick={() => onSelect(chat.id)}
            >
              <span className={styles.avatar} aria-hidden="true">{initials(title)}</span>
              <span className={styles.chatName}>
                {title}
                {chat.projectTitle && <span className={styles.project}>{chat.projectTitle}</span>}
                {chat.type === 'support' && <span className={styles.project}>Support</span>}
              </span>
              <span className={styles.chatTime}>{formatListTime(chat.lastMessageAt ?? chat.createdAt)}</span>
              <span className={styles.chatPreview}>
                {last ? `${mine ? 'You: ' : ''}${last.body}` : 'No messages yet'}
              </span>
              {chat.unread > 0
                ? <span className={styles.badge} aria-hidden="true">{chat.unread > 99 ? '99+' : chat.unread}</span>
                : <span aria-hidden="true" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
