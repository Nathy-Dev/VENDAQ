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
  const [activeTab, setActiveTab] = React.useState<"chats" | "status" | "groups">("chats");

  if (isLoading) {
    return (
      <div className={styles.inboxContainer}>
        <nav className={styles.tabs}>
            <div className={`${styles.tabItem} animate-pulse`}>Chats</div>
            <div className={`${styles.tabItem} animate-pulse`}>Status</div>
            <div className={`${styles.tabItem} animate-pulse`}>Groups</div>
        </nav>
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

  const filteredChats = chats?.filter(chat => {
      if (activeTab === "chats") return !chat.isGroup;
      if (activeTab === "groups") return chat.isGroup;
      return false;
  });

  return (
    <div className={styles.inboxContainer}>
      <nav className={styles.tabs}>
          <button 
            className={`${styles.tabItem} ${activeTab === "chats" ? styles.activeTab : ""}`}
            onClick={() => setActiveTab("chats")}
          >
              Chats
          </button>
          <button 
            className={`${styles.tabItem} ${activeTab === "status" ? styles.activeTab : ""}`}
            onClick={() => setActiveTab("status")}
          >
              Status
          </button>
          <button 
            className={`${styles.tabItem} ${activeTab === "groups" ? styles.activeTab : ""}`}
            onClick={() => setActiveTab("groups")}
          >
              Groups
          </button>
      </nav>

      <div className={styles.chatList}>
        {activeTab === "status" ? (
             <StatusView chats={chats} />
        ) : !filteredChats || filteredChats.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.inboxIcon}>
              <MessageSquare size={80} strokeWidth={1} />
            </div>
            <h2 className={styles.emptyTitle}>
                {activeTab === "groups" ? "No Groups Found" : "WhatsApp for PIPELIXR"}
            </h2>
            <p className={styles.emptyDesc}>
              {activeTab === "groups" ? "Syncing your groups... please wait." : "Connect your phone to sync your messages. PIPELIXR keeps your chats safe and organized."}
            </p>
            <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', width: '100%' }}>
              <p style={{ fontSize: '0.7rem', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <ShieldAlert size={12} /> End-to-end encrypted sync
              </p>
            </div>
          </div>
        ) : (
          filteredChats.map((chat) => (
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
                <div className={styles.lastMessage}>
                  {chat.lastMessageType === "image" && "📷 "}
                  {chat.lastMessageType === "video" && "🎥 "}
                  {chat.lastMessageType === "audio" && "🎤 "}
                  {chat.lastMessageType === "document" && "📄 "}
                  {chat.lastMessage}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatusView({ chats }: { chats: ChatThread[] | undefined }) {
    // In a real implementation, we would query the 'statuses' table
    // For now, let's show a placeholder
    return (
        <div className={styles.statusView}>
             <div className={styles.myStatus}>
                  <div className={styles.avatar}>
                      <UserIcon size={24} color="#e9edef" />
                  </div>
                  <div className={styles.chatInfo}>
                      <div className={styles.customerName}>My Status</div>
                      <div className={styles.lastMessage}>Tap to add status update</div>
                  </div>
             </div>
             <div className={styles.recentUpdates}>
                  <div className={styles.statusHeader}>RECENT UPDATES</div>
                  <div className={styles.emptyState} style={{ padding: '2rem' }}>
                      <p style={{ color: '#8696a0', fontSize: '0.9rem' }}>No recent updates from your contacts.</p>
                  </div>
             </div>
        </div>
    );
}
