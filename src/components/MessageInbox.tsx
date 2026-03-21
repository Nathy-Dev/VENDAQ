"use client";

import React from "react";
import { MessageSquare, User as UserIcon, Search, MoreVertical, ShieldAlert } from "lucide-react";

import styles from "./MessageInbox.module.css";
import { formatDistanceToNow } from "date-fns";
import Image from "next/image";
import { ChatThread } from "@/types";


interface MessageInboxProps {
  chats: ChatThread[] | undefined;
  isLoading: boolean;
  onSelectChat?: (chat: ChatThread) => void;
}


export default function MessageInbox({ chats, isLoading, onSelectChat }: MessageInboxProps) {
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
            <div className={styles.inboxIcon}>
              <MessageSquare size={80} strokeWidth={1} />
            </div>
            <h2 className={styles.emptyTitle}>WhatsApp for PIPELIXR</h2>
            <p className={styles.emptyDesc}>
              Connect your phone to sync your messages. PIPELIXR keeps your chats safe and organized.
            </p>
            <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', width: '100%' }}>
              <p style={{ fontSize: '0.7rem', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <ShieldAlert size={12} /> End-to-end encrypted sync
              </p>

            </div>
          </div>
        ) : (

          chats.map((chat) => (
            <div 
                key={chat._id} 
                className={styles.ChatItem}
                onClick={() => onSelectChat?.(chat)}
            >
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
