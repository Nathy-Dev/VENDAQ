"use client";

import React, { useRef, useEffect } from "react";
import { ArrowLeft, Send, User as UserIcon, MoreVertical, Smile, Paperclip } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ChatThread } from "@/types";
import { Id } from "../../convex/_generated/dataModel";
import { format } from "date-fns";
import styles from "./MessageThread.module.css";
import { formatDisplayName } from "@/utils/format";

interface MessageThreadProps {
  chat: ChatThread;
  businessId: string;
  onBack: () => void;
}

export default function MessageThread({ chat, businessId, onBack }: MessageThreadProps) {
  const messages = useQuery(api.interactions.getChatMessages, 
    businessId && chat._id ? {
      businessId: businessId as Id<"businesses">,
      customerId: chat._id
    } : "skip"
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className={styles.threadContainer}>
      <header className={styles.threadHeader}>
        <button className={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={24} />
        </button>
        <div className={styles.avatar}>
           <UserIcon size={24} color="#e9edef" />
        </div>
        <div className={styles.userInfo}>
           <div className={styles.userName}>{formatDisplayName(chat.name, chat.phone)}</div>
           <div className={styles.userStatus}>online</div>
        </div>
        <div style={{ color: '#8696a0', display: 'flex', gap: '1.2rem' }}>
            <MoreVertical size={20} />
        </div>
      </header>

      <div className={styles.messagesList} ref={scrollRef}>
        {!messages ? (
           <div className="flex items-center justify-center h-full text-slate-500 text-sm">Loading interaction history...</div>
        ) : messages.length === 0 ? (
           <div className="flex items-center justify-center h-full text-slate-500 text-sm italic">No messages found in history</div>
        ) : (
           messages.map((msg) => (
             <div 
               key={msg._id} 
               className={`${styles.messageRow} ${msg.role === "owner" ? styles.outgoing : styles.incoming}`}
             >
               <div className={styles.messageBubble}>
                 {msg.mediaId && (
                   <MessageMedia mediaId={msg.mediaId} type={msg.messageType} fileName={msg.fileName} />
                 )}
                 <div className={styles.messageContent}>{msg.content}</div>
                 <div className={styles.messageTime}>
                   {format(new Date(msg.timestamp), "HH:mm")}
                 </div>
               </div>
             </div>
           ))
        )}
      </div>

      <footer className={styles.inputArea}>
        <div style={{ color: '#8696a0', display: 'flex', gap: '1.2rem' }}>
            <Smile size={24} />
            <Paperclip size={24} />
        </div>
        <input 
          type="text" 
          placeholder="New message coming soon..." 
          className={styles.inputField}
          disabled 
        />
        <button className={styles.sendBtn} disabled>
          <Send size={24} />
        </button>
      </footer>
    </div>
  );
}

function MessageMedia({ mediaId, type, fileName }: { mediaId: string, type?: string, fileName?: string }) {
    const url = useQuery(api.interactions.getMediaUrl, { mediaId });
    
    if (!url) return <div className={styles.mediaPlaceholder}>Loading media...</div>;

    if (type === "image") {
        return (
            <div className={styles.mediaContainer}>
                <img src={url} alt="Shared media" className={styles.mediaImage} />
            </div>
        );
    }

    if (type === "video") {
        return (
            <div className={styles.mediaContainer}>
                <video src={url} controls className={styles.mediaVideo} />
            </div>
        );
    }

    if (type === "audio") {
        return (
            <div className={styles.mediaContainer}>
                <audio src={url} controls className={styles.mediaAudio} />
            </div>
        );
    }

    return (
        <a href={url} target="_blank" rel="noopener noreferrer" className={styles.fileLink}>
            <Paperclip size={16} /> {fileName || "Download file"}
        </a>
    );
}
