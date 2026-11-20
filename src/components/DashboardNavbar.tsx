"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { useEffect, useSyncExternalStore } from "react";
import { Home, MessageCircle, ListTodo, Radio, Settings, UserRound, LogOut, PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { initials } from "@/lib/workspace-ui";
import Brand from "./Brand";
import styles from "./DashboardNavbar.module.css";
import { STATUS_TO_CASH_ENABLED } from "@/lib/launch-flags";

const mainNavigation = [
  { href: "/dashboard", icon: Home, label: "Home" },
  { href: "/pipeline", icon: MessageCircle, label: "Inbox" },
  { href: "/revenue", icon: ListTodo, label: "Actions" },
  ...(STATUS_TO_CASH_ENABLED ? [{ href: "/status", icon: Radio, label: "Viewers" }] : []),
];
const accountNavigation = [
  { href: "/profile", icon: UserRound, label: "Profile" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

const SIDEBAR_STORAGE_KEY = "pipelixr-sidebar-collapsed";
const SIDEBAR_CHANGE_EVENT = "pipelixr-sidebar-change";
let sidebarCollapsedFallback = false;

function getSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return sidebarCollapsedFallback;
  }
}

function subscribeToSidebar(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(SIDEBAR_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, callback);
  };
}

export default function DashboardNavbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const workspace = useQuery(api.foundation.workspace, {});
  const userName = session?.user?.name || "Your account";
  const collapsed = useSyncExternalStore(subscribeToSidebar, getSidebarCollapsed, () => false);

  useEffect(() => {
    document.documentElement.dataset.sidebarCollapsed = String(collapsed);
  }, [collapsed]);

  function toggleSidebar() {
    const next = !collapsed;
    sidebarCollapsedFallback = next;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      // Keep the in-memory preference for this visit.
    }
    document.documentElement.dataset.sidebarCollapsed = String(next);
    window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
  }

  function navigationLink(item: { href: string; icon: LucideIcon; label: string }, mobile = false) {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const Icon = item.icon;
    return (
      <Link key={item.href} href={item.href} aria-label={item.label} aria-current={active ? "page" : undefined} title={item.label}
        className={`${mobile ? styles.bottomLink : styles.navLink} ${active ? styles.active : ""}`}>
        <Icon size={24} strokeWidth={active ? 2.3 : 1.7} aria-hidden="true" />
        <span className={styles.navLabel}>{item.label}</span>
      </Link>
    );
  }

  return (
    <>
      <aside id="workspace-sidebar" className={styles.sidebar} aria-label="Workspace navigation" data-collapsed={collapsed}>
        <Link href="/dashboard" className={styles.brand} aria-label="Pipelixr home"><Brand compact={collapsed} /></Link>
        <button
          type="button"
          className={styles.collapseButton}
          onClick={toggleSidebar}
          aria-controls="workspace-sidebar"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={15} aria-hidden="true" /> : <PanelLeftClose size={15} aria-hidden="true" />}
        </button>
        <nav className={styles.mainNav} aria-label="Main">{mainNavigation.map((item) => navigationLink(item))}</nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.workspaceInfo}>
            <span className={styles.workspaceAvatar}>{initials(workspace?.name ?? "Your business")}</span>
            <div><strong>{workspace?.name ?? "Your business"}</strong><span><i data-connected={workspace?.state === "connected"} />{workspace?.state === "connected" ? "WhatsApp connected" : "Not connected"}</span></div>
          </div>
          <nav aria-label="Account">{accountNavigation.map((item) => navigationLink(item))}</nav>
          <button type="button" className={styles.navLink} onClick={() => void signOut({ callbackUrl: "/login" })} aria-label="Sign out" title="Sign out">
            <LogOut size={24} strokeWidth={1.7} aria-hidden="true" /><span className={styles.navLabel}>Sign out</span>
          </button>
          <p className={styles.footerNote}>A little more clarity. Every day.</p>
        </div>
      </aside>
      <header className={styles.mobileHeader}>
        <Link href="/dashboard" aria-label="Pipelixr home"><Brand /></Link>
        <Link href="/settings" className={styles.iconButton} aria-label="Settings"><Settings size={23} strokeWidth={1.7} /></Link>
      </header>
      <nav className={styles.bottomNav} aria-label="Mobile main">
        {mainNavigation.map((item) => navigationLink(item, true))}
        <Link href="/profile" className={`${styles.bottomLink} ${pathname === "/profile" ? styles.active : ""}`} aria-label="Profile" aria-current={pathname === "/profile" ? "page" : undefined}>
          <span className={styles.userAvatar}>{initials(userName)}</span><span className={styles.navLabel}>Profile</span>
        </Link>
      </nav>
    </>
  );
}
