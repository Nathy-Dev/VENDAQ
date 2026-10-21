"use client";

import React from "react";
import DashboardNavbar from "./DashboardNavbar";
import styles from "./DashboardShell.module.css";

/**
 * Shared frame for every signed-in page.
 * Handles the fixed sidebar offset, page padding and the mobile
 * header/bottom-nav clearances so pages never have to.
 */
export default function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <DashboardNavbar />
      <main className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}
