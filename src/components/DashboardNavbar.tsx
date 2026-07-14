"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  LayoutDashboard,
  Zap,
  TrendingUp,
  GitBranch,
  Settings,
  User,
  LogOut,
  ChevronUp,
  Menu,
  X,
  MessageCircle,
  ChevronLeft,
} from "lucide-react";
import styles from "./DashboardNavbar.module.css";
import { ChatThread } from "@/types";

const MAIN_NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/pipeline", icon: GitBranch, label: "Pipeline" },
  { href: "/status", icon: Zap, label: "Status-to-Cash" },
  { href: "/revenue", icon: TrendingUp, label: "Revenue Ops" },
];

const ACCOUNT_NAV = [
  { href: "/profile", icon: User, label: "Profile" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export default function DashboardNavbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      isCollapsed ? "64px" : "230px"
    );
  }, [isCollapsed]);

  const business = useQuery(
    api.businesses.getBusiness,
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  const chats = useQuery(
    api.interactions.getRecentChats,
    business ? { businessId: business._id } : "skip"
  ) as ChatThread[] | undefined;

  const newChatsCount = chats?.length ?? 0;

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const userInitial = (
    session?.user?.name?.[0] ||
    session?.user?.email?.[0] ||
    "U"
  ).toUpperCase();

  const closeMobile = () => setIsMobileOpen(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className={styles.mobileHeader}>
        <button
          className={styles.hamburger}
          onClick={() => setIsMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
        <Link href="/dashboard" onClick={closeMobile}>
          <Image
            src="/logo.png"
            alt="PIPELIXR"
            width={30}
            height={30}
            style={{ borderRadius: 7, display: "block" }}
          />
        </Link>
        <div style={{ width: 36 }} />
      </div>

      {/* Mobile overlay */}
      <div
        className={`${styles.mobileOverlay} ${isMobileOpen ? styles.mobileOverlayVisible : ""}`}
        onClick={closeMobile}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${isMobileOpen ? styles.sidebarOpen : ""} ${isCollapsed ? styles.sidebarCollapsed : ""}`}>
        {/* Logo */}
        <div className={styles.logoSection}>
          <Link href="/dashboard" className={styles.logoLink} onClick={closeMobile}>
            <Image
              src="/logo.png"
              alt="PIPELIXR"
              width={30}
              height={30}
              className={styles.logoImg}
            />
            <span className={styles.logoText}>PIPELIXR</span>
          </Link>
          <button className={styles.closeBtn} onClick={closeMobile} aria-label="Close menu">
            <X size={15} />
          </button>
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          <span className={styles.navSectionLabel}>Workspace</span>

          {MAIN_NAV.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className={`${styles.navItem} ${pathname === href ? styles.navItemActive : ""}`}
              onClick={closeMobile}
            >
              <Icon size={16} className={styles.navIcon} />
              <span className={styles.navLabel}>{label}</span>
            </Link>
          ))}

          {newChatsCount > 0 && (
            <Link
              href="/dashboard"
              className={styles.navItem}
              onClick={closeMobile}
            >
              <MessageCircle size={16} className={styles.navIcon} />
              <span className={styles.navLabel}>New Messages</span>
              <span className={styles.navBadge}>
                {newChatsCount > 9 ? "9+" : newChatsCount}
              </span>
            </Link>
          )}

          <span className={styles.navSectionLabel} style={{ marginTop: "0.5rem" }}>
            Account
          </span>

          {ACCOUNT_NAV.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className={`${styles.navItem} ${pathname === href ? styles.navItemActive : ""}`}
              onClick={closeMobile}
            >
              <Icon size={16} className={styles.navIcon} />
              <span className={styles.navLabel}>{label}</span>
            </Link>
          ))}

          <button
            className={`${styles.navItem} ${styles.collapseNavBtn}`}
            onClick={() => setIsCollapsed(!isCollapsed)}
            aria-label="Toggle sidebar"
          >
            <ChevronLeft size={16} className={`${styles.collapseIcon} ${isCollapsed ? styles.collapseIconRotated : ""}`} />
            <span className={styles.navLabel}>Collapse</span>
          </button>
        </nav>

        {/* User card */}
        <div className={styles.userSection} ref={userMenuRef}>
          {isUserMenuOpen && (
            <div className={styles.dropdown}>
              <button
                className={`${styles.dropdownItem} ${styles.logoutItem}`}
                onClick={() => {
                  signOut({ callbackUrl: "/login" });
                  setIsUserMenuOpen(false);
                }}
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          )}

          <button
            className={styles.userCard}
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            aria-expanded={isUserMenuOpen}
          >
            <div className={styles.avatar}>
              {session?.user?.image ? (
                <Image
                  src={session.user.image}
                  alt="Avatar"
                  width={33}
                  height={33}
                  className={styles.avatarImg}
                />
              ) : (
                <span>{userInitial}</span>
              )}
            </div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>
                {session?.user?.name || "User"}
              </span>
              <span className={styles.userEmail}>
                {session?.user?.email || ""}
              </span>
            </div>
            <ChevronUp
              size={13}
              className={`${styles.chevron} ${isUserMenuOpen ? styles.chevronDown : ""}`}
            />
          </button>
        </div>
      </aside>
    </>
  );
}
