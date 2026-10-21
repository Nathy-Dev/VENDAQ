"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  Home,
  UsersRound,
  Radio,
  Send,
  Settings,
  UserRound,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import styles from "./DashboardNavbar.module.css";
import { ChatThread } from "@/types";

const MAIN_NAV = [
  { href: "/dashboard", icon: Home, label: "Overview" },
  { href: "/pipeline", icon: UsersRound, label: "My Leads" },
  { href: "/status", icon: Radio, label: "Viewers" },
  { href: "/revenue", icon: Send, label: "Send Actions" },
];

const ACCOUNT_NAV = [
  { href: "/profile", icon: UserRound, label: "My Profile" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
      isCollapsed ? "72px" : "240px"
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

  useEffect(() => {
    if (!isMobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMobileOpen]);

  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  const userInitial = (
    session?.user?.name?.[0] ||
    session?.user?.email?.[0] ||
    "U"
  ).toUpperCase();

  const closeMobile = () => setIsMobileOpen(false);
  const accountActive = ACCOUNT_NAV.some((item) => isActive(pathname, item.href));

  const navLink = (
    { href, icon: Icon, label }: (typeof MAIN_NAV)[number],
    badge?: number
  ) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
        onClick={closeMobile}
        aria-current={active ? "page" : undefined}
        title={isCollapsed ? label : undefined}
      >
        <Icon size={17} className={styles.navIcon} strokeWidth={1.9} />
        <span className={styles.navLabel}>{label}</span>
        {badge ? (
          <span className={styles.navBadge}>{badge > 9 ? "9+" : badge}</span>
        ) : null}
      </Link>
    );
  };

  return (
    <>
      {/* ── Mobile top bar ─────────────────────────────────── */}
      <header className={styles.mobileHeader}>
        <button
          className={styles.iconBtn}
          onClick={() => setIsMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={19} />
        </button>
        <Link href="/dashboard" className={styles.mobileBrand} aria-label="PIPELIXR home">
          <Image src="/logo.png" alt="" width={26} height={26} className={styles.mobileLogo} />
          <span>PIPELIXR</span>
        </Link>
        <Link href="/profile" className={styles.mobileAvatar} aria-label="Your profile">
          {session?.user?.image ? (
            <Image
              src={session.user.image}
              alt=""
              width={28}
              height={28}
              className={styles.avatarImg}
            />
          ) : (
            <span>{userInitial}</span>
          )}
        </Link>
      </header>

      {/* ── Drawer scrim ───────────────────────────────────── */}
      <div
        className={`${styles.mobileOverlay} ${isMobileOpen ? styles.mobileOverlayVisible : ""}`}
        onClick={closeMobile}
        aria-hidden="true"
      />

      {/* ── Sidebar / drawer ───────────────────────────────── */}
      <aside
        className={`${styles.sidebar} ${isMobileOpen ? styles.sidebarOpen : ""} ${
          isCollapsed ? styles.sidebarCollapsed : ""
        }`}
      >
        <div className={styles.logoSection}>
          <Link href="/dashboard" className={styles.logoLink} onClick={closeMobile}>
            <Image
              src="/logo.png"
              alt=""
              width={28}
              height={28}
              className={styles.logoImg}
            />
            <span className={styles.logoText}>PIPELIXR</span>
          </Link>
          <button
            className={styles.closeBtn}
            onClick={closeMobile}
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>

        <nav className={styles.nav} aria-label="Main">
          <span className={styles.navSectionLabel}>Workspace</span>
          {MAIN_NAV.map((item) =>
            navLink(item, item.href === "/dashboard" ? newChatsCount : undefined)
          )}

          <span className={`${styles.navSectionLabel} ${styles.navSectionLabelSpaced}`}>
            Account
          </span>
          {ACCOUNT_NAV.map(({ href, icon: Icon, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                onClick={closeMobile}
                aria-current={active ? "page" : undefined}
                title={isCollapsed ? label : undefined}
              >
                <Icon size={17} className={styles.navIcon} strokeWidth={1.9} />
                <span className={styles.navLabel}>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <button
            className={styles.collapseBtn}
            onClick={() => setIsCollapsed(!isCollapsed)}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span className={styles.navLabel}>Collapse</span>
          </button>

          <div className={styles.userSection} ref={userMenuRef}>
            {isUserMenuOpen && (
              <div className={styles.dropdown} role="menu">
                <Link
                  href="/profile"
                  className={styles.dropdownItem}
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    closeMobile();
                  }}
                  role="menuitem"
                >
                  <UserRound size={14} />
                  View profile
                </Link>
                <Link
                  href="/settings"
                  className={styles.dropdownItem}
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    closeMobile();
                  }}
                  role="menuitem"
                >
                  <Settings size={14} />
                  Settings
                </Link>
                <button
                  className={`${styles.dropdownItem} ${styles.logoutItem}`}
                  onClick={() => {
                    signOut({ callbackUrl: "/login" });
                    setIsUserMenuOpen(false);
                  }}
                  role="menuitem"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            )}

            <button
              className={styles.userCard}
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              aria-expanded={isUserMenuOpen}
            >
              <span className={styles.avatar}>
                {session?.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt=""
                    width={32}
                    height={32}
                    className={styles.avatarImg}
                  />
                ) : (
                  <span>{userInitial}</span>
                )}
              </span>
              <span className={styles.userMeta}>
                <span className={styles.userName}>
                  {session?.user?.name || "User"}
                </span>
                <span className={styles.userEmail}>
                  {session?.user?.email || ""}
                </span>
              </span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile bottom navigation ───────────────────────── */}
      <nav className={styles.bottomNav} aria-label="Quick navigation">
        {MAIN_NAV.map(({ href, icon: Icon, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={`${styles.bottomItem} ${active ? styles.bottomItemActive : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`${styles.bottomItem} ${accountActive ? styles.bottomItemActive : ""}`}
          onClick={() => setIsMobileOpen(true)}
          aria-label="More options"
        >
          <Menu size={19} />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
