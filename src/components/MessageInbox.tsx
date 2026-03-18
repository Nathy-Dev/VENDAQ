"use client";

import React from "react";
import { MessageSquare, User as UserIcon, Search, MoreVertical } from "lucide-react";
import styles from "./MessageInbox.module.css";
import { formatDistanceToNow } from "date-fns";
import Image from "next/image";
import { ChatThread } from "@/types";


interface MessageInboxProps {
  chats: ChatThread[] | undefined;
  isLoading: boolean;
}


export default function MessageInbox({ chats, isLoading }: MessageInboxProps) {
  if (isLoading) {
    return (
      <div className={styles.inboxContainer}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>Messages</div>
        </div>
        <div className={styles.emptyState}>
          <div className="animate-pulse flex space-y-4 flex-col w-full">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-4 items-center">
                <div className="rounded-full bg-slate-800 h-12 w-12"></div>
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-2 bg-slate-800 rounded"></div>
                  <div className="h-2 bg-slate-800 rounded w-5/6"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.inboxContainer}>
      <header className={styles.header}>
        <div className={styles.headerTitle}>Messages</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '1rem', color: '#8696a0' }}>
            <Search size={20} />
            <MoreVertical size={20} />
        </div>
      </header>

      <div className={styles.chatList}>
        {!chats || chats.length === 0 ? (
          <div className={styles.emptyState}>
            <MessageSquare size={48} className={styles.inboxIcon} />
            <p>No messages yet.</p>
            <p style={{ fontSize: '0.8rem' }}>Once your WhatsApp is connected, your messages will appear here.</p>
          </div>
        ) : (
          chats.map((chat) => (
            <div key={chat._id} className={styles.ChatItem}>
              <div className={styles.avatar}>
                {chat.image ? (
                  <Image 
                    src={chat.image} 
                    alt={chat.name || "Customer"} 
                    width={48} 
                    height={48} 
                    className={styles.avatar} 
                  />
                ) : (
                  <UserIcon size={24} color="#e9edef" />
                )}
              </div>

              <div className={styles.chatInfo}>
                <div className={styles.chatTop}>
                  <span className={styles.customerName}>{chat.name || chat.phone}</span>
                  <span className={styles.timestamp}>
                    {formatDistanceToNow(chat.lastMessageTimestamp, { addSuffix: false })}
                  </span>
                </div>
                <div className={styles.lastMessage}>{chat.lastMessage}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
