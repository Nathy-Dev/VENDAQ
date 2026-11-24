"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import DashboardNavbar from "./DashboardNavbar";
import styles from "./DashboardShell.module.css";

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSettings = pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <div className={`${styles.shell} ${isSettings ? styles.settingsShell : ""}`}>
      <DashboardNavbar />
      <a className="skip-link" href="#main-content">Skip to content</a>
      <main id="main-content" tabIndex={-1} className={`${styles.main} ${isSettings ? styles.settingsMain : ""}`}>
        <div className={`${styles.content} ${isSettings ? styles.settingsContent : ""}`}>{children}</div>
      </main>
      {!isSettings && <footer className={styles.footer}><Link href="/legal/terms">Terms</Link><Link href="/legal/privacy">Privacy</Link><Link href="/legal/dpa">DPA</Link><Link href="/legal/billing">Billing</Link><Link href="/legal/subprocessors">Subprocessors</Link></footer>}
    </div>
  );
}
