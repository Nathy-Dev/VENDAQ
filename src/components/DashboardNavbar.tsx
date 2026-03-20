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
  const [selectedChat, setSelectedChat] = useState<ChatThread | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
            alt="MERXAGE Logo" 
            width={32} 
            height={32} 
            className={styles.logoImg}
          />
          <span>
            MERX<span className={styles.logoAccent}>AGE</span>
          </span>
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

          <button className={styles.avatarBtn} style={{ background: 'transparent', border: 'none', color: '#94a3b8', width: 'auto', height: 'auto', marginRight: '0.5rem' }}>
            <Bell size={20} />
          </button>
          
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
