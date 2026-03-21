"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { 
  User, 
  Settings, 
  LogOut, 
  Bell,
  LayoutDashboard,
  MessageSquare,
  X
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import MessageInbox from "./MessageInbox";
import MessageThread from "./MessageThread";
import { ChatThread } from "@/types";
import styles from "./DashboardNavbar.module.css";

export default function DashboardNavbar() {
  const { data: session } = useSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedChat, setSelectedChat] = useState<ChatThread | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  const chats = useQuery(api.interactions.getRecentChats,
    business ? { businessId: business._id } : "skip"
  ) as ChatThread[] | undefined;

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    signOut({ callbackUrl: "/login" });
  };

  const userInitial = session?.user?.name?.[0] || session?.user?.email?.[0] || "U";

  return (
    <nav className={styles.navbar}>
      <div className={styles.container}>
        {/* Logo Section */}
        <Link href="/dashboard" className={styles.logoArea}>
          <Image 
            src="/logo.png" 
            alt="Logo" 
            width={36} 
            height={36} 
            className={styles.logoImg}
          />
        </Link>

        {/* Actions Section */}
        <div className={styles.navActions}>
          <button 
            className={styles.avatarBtn} 
            style={{ background: 'transparent', border: 'none', color: isInboxOpen ? '#10b981' : '#94a3b8', width: 'auto', height: 'auto', marginRight: '0.5rem' }}
            onClick={() => setIsInboxOpen(!isInboxOpen)}
            aria-label="Open messages"
          >
            <MessageSquare size={20} />
          </button>

          <div className={styles.userMenuWrapper} ref={notificationsRef}>
            <button 
              className={styles.avatarBtn} 
              style={{ background: 'transparent', border: 'none', color: isNotificationsOpen ? '#10b981' : '#94a3b8', width: 'auto', height: 'auto', marginRight: '0.5rem', position: 'relative' }}
              onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
              aria-label="Notifications"
            >
              <Bell size={20} />
              {chats && chats.length > 0 && (
                <span className="absolute top-1 right-0 w-2 h-2 bg-red-500 rounded-full animate-pulse border border-[#0f172a]"></span>
              )}
            </button>

            {isNotificationsOpen && (
              <div className={`${styles.dropdown} w-80 max-h-96 overflow-y-auto`} style={{ right: '-120px' }}>
                <div className="p-3 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-[#0f172a]/95 backdrop-blur-sm z-10">
                  <span className="font-bold text-slate-200">Notifications</span>
                  {chats && chats.length > 0 && <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">{chats.length} New</span>}
                </div>
                
                <div className="flex flex-col">
                  {chats && chats.length > 0 ? (
                    chats.slice(0, 5).map(chat => (
                      <div 
                        key={chat._id} 
                        className="p-4 hover:bg-slate-800/50 border-b border-slate-800/50 cursor-pointer transition-colors"
                        onClick={() => {
                          setSelectedChat(chat);
                          setIsInboxOpen(true);
                          setIsNotificationsOpen(false);
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 font-bold text-xs uppercase">
                            {chat.name?.[0] || chat.phone.substring(0, 2)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-200">{chat.name || chat.phone}</p>
                            <p className="text-xs text-slate-400 mt-1 line-clamp-1">{chat.lastMessage}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-slate-500 text-sm">
                      <Bell size={24} className="mx-auto mb-2 opacity-50" />
                      No new notifications
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          
          <div className={styles.userMenuWrapper} ref={menuRef}>
            <button 
              className={styles.avatarBtn}
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-label="User menu"
            >
              {session?.user?.image ? (
                <Image 
                  src={session.user.image} 
                  alt="Avatar" 
                  width={44} 
                  height={44} 
                  className={styles.avatarImg}
                />
              ) : (
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>{userInitial}</span>
              )}
            </button>

            {isMenuOpen && (
              <div className={styles.dropdown}>
                <div className={styles.userInfo}>
                  <span className={styles.userName}>{session?.user?.name || "User"}</span>
                  <span className={styles.userEmail}>{session?.user?.email || ""}</span>
                </div>
                
                <Link href="/dashboard" className={styles.menuItem} onClick={() => setIsMenuOpen(false)}>
                  <LayoutDashboard size={18} className={styles.menuIcon} />
                  Dashboard
                </Link>
                
                <Link href="/profile" className={styles.menuItem} onClick={() => setIsMenuOpen(false)}>
                  <User size={18} className={styles.menuIcon} />
                  Profile Settings
                </Link>
                
                <Link href="/settings" className={styles.menuItem} onClick={() => setIsMenuOpen(false)}>
                  <Settings size={18} className={styles.menuIcon} />
                  Account Settings
                </Link>
                
                <div className={styles.divider} />
                
                <button 
                  onClick={handleLogout}
                  className={`${styles.menuItem} ${styles.logoutBtn}`}
                >
                  <LogOut size={18} />
                  Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Message Inbox Overlay */}
      {isInboxOpen && (
        <div className={styles.inboxOverlay}>
          <div className={styles.inboxHeader}>
            <div className={styles.inboxHeaderTitle}>
              <MessageSquare size={20} className={styles.logoAccent} />
              <span>WhatsApp Messages</span>
            </div>
            <button 
              className={styles.closeInboxBtn}
              onClick={() => setIsInboxOpen(false)}
            >
              <X size={24} />
            </button>
          </div>
          <div className={styles.inboxContent}>
            {selectedChat ? (
                <MessageThread 
                  chat={selectedChat} 
                  businessId={business?._id || ""} 
                  onBack={() => setSelectedChat(null)} 
                />
            ) : (
                <MessageInbox 
                  chats={chats} 
                  isLoading={chats === undefined} 
                  onSelectChat={(chat) => setSelectedChat(chat)}
                />
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
