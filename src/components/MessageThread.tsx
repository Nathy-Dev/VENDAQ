"use client";

import React, { useRef, useEffect } from "react";
import { ArrowLeft, Send, User as UserIcon, MoreVertical, Smile, Paperclip, Check, CheckCheck, AlertCircle, Loader2 } from "lucide-react";
import Image from "next/image";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ChatThread } from "@/types";
import { Id } from "../../convex/_generated/dataModel";
import { format } from "date-fns";
import styles from "./MessageThread.module.css";
import { formatDisplayName } from "@/utils/format";
import { useAction } from "convex/react";

interface MessageThreadProps {
  chat: ChatThread;
  businessId: string;
  onBack: () => void;
}

interface OptimisticMessage {
  _id: string;
  role: "owner";
  content: string;
  timestamp: number;
  messageType: "text";
  isOptimistic: boolean;
  status: "sending" | "sent" | "failed";
  mediaId?: string;
  fileName?: string;
}

export default function MessageThread({ chat, businessId, onBack }: MessageThreadProps) {
  const messages = useQuery(api.interactions.getChatMessages, 
    businessId && chat._id ? {
      businessId: businessId as Id<"businesses">,
      customerId: chat._id
    } : "skip"
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  const [inputValue, setInputValue] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);
  const [optimisticMessages, setOptimisticMessages] = React.useState<OptimisticMessage[]>([]);
  const sendMessageAction = useAction(api.whatsapp.sendMessageAction);

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, optimisticMessages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isSending) return;

    setIsSending(true);
    const content = inputValue.trim();
    
    // Optimistic Update
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: OptimisticMessage = {
        _id: tempId,
        role: "owner",
        content,
        timestamp: Date.now(),
        messageType: "text",
        isOptimistic: true,
        status: "sending"
    };
    setOptimisticMessages(prev => [...prev, optimisticMsg]);
    setInputValue("");

    try {
        await sendMessageAction({
            businessId: businessId as Id<"businesses">,
            customerId: chat._id,
            content,
        });
        
        // Mark as sent
        setOptimisticMessages(prev => prev.map(m => m._id === tempId ? { ...m, status: "sent" } : m));
        
        // Remove optimistic message once real one (hopefully) arrives via sync
        setTimeout(() => {
            setOptimisticMessages(prev => prev.filter(m => m._id !== tempId));
        }, 5000); 
    } catch (error) {
        console.error("Failed to send message:", error);
        // Mark as failed
        setOptimisticMessages(prev => prev.map(m => m._id === tempId ? { ...m, status: "failed" } : m));
    } finally {
        setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
  };

  // Merge real and optimistic messages
  const allMessages = React.useMemo(() => {
    if (!messages) return [];
    
    // Filter out optimistic messages that already exist in the real list (by content and approximate time)
    const filteredOptimistic = optimisticMessages.filter(om => 
        !messages.some(rm => rm.role === "owner" && rm.content === om.content && Math.abs(rm.timestamp - om.timestamp) < 5000)
    );
    
    return [...messages, ...filteredOptimistic].sort((a, b) => a.timestamp - b.timestamp);
  }, [messages, optimisticMessages]);

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
        ) : allMessages.length === 0 ? (
           <div className="flex items-center justify-center h-full text-slate-500 text-sm italic">No messages found in history</div>
        ) : (
           allMessages.map((msg) => (
             <div 
               key={msg._id} 
               className={`${styles.messageRow} ${msg.role === "owner" ? styles.outgoing : styles.incoming} ${'isOptimistic' in msg && msg.isOptimistic ? styles.optimistic : ""}`}
             >
               <div className={styles.messageBubble}>
                 {('mediaId' in msg && msg.mediaId) && (
                   <MessageMedia mediaId={msg.mediaId} type={msg.messageType} fileName={('fileName' in msg ? msg.fileName : undefined)} />
                 )}
                 <div className={styles.messageContent}>{msg.content}</div>
                 <div className={styles.messageFooter}>
                    <div className={styles.messageTime}>
                        {format(new Date(msg.timestamp), "HH:mm")}
                    </div>
                    {msg.role === "owner" && (
                        <div className={styles.statusIcon}>
                            {'isOptimistic' in msg ? (
                                msg.status === "sending" ? <Loader2 size={12} className="animate-spin" /> :
                                msg.status === "failed" ? <AlertCircle size={12} color="#ef4444" /> :
                                <Check size={12} />
                            ) : (
                                <CheckCheck size={12} color="#53bdeb" />
                            )}
                        </div>
                    )}
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
          placeholder="Type a message..." 
          className={styles.inputField}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyPress}
          disabled={isSending}
        />
        <button 
          className={styles.sendBtn} 
          onClick={handleSendMessage}
          disabled={isSending || !inputValue.trim()}
        >
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
                <Image 
                    src={url} 
                    alt="Shared media" 
                    className={styles.mediaImage} 
                    width={400} 
                    height={300} 
                    unoptimized 
                />
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
