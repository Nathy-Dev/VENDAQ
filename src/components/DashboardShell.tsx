"use client";

import React from "react";
import DashboardNavbar from "./DashboardNavbar";
import styles from "./DashboardShell.module.css";

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <DashboardNavbar />
      <a className="skip-link" href="#main-content">Skip to content</a>
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}
