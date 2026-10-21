"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./dashboard-ui.module.css";

export type Tone = "neutral" | "positive" | "warning" | "danger" | "info" | "violet";

/* ── Page header ─────────────────────────────────────────── */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderText}>
        {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}

/* ── Stats ───────────────────────────────────────────────── */

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.statGrid}>{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  return (
    <div className={styles.statCard} data-tone={tone}>
      <div className={styles.statTop}>
        <span className={styles.statLabel}>{label}</span>
        {Icon && (
          <span className={styles.statIcon}>
            <Icon size={15} />
          </span>
        )}
      </div>
      <div className={styles.statValue}>{value}</div>
      {hint && <div className={styles.statHint}>{hint}</div>}
    </div>
  );
}

/* ── Panels ──────────────────────────────────────────────── */

export function Panel({
  title,
  description,
  action,
  children,
  flush = false,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={className ? `${styles.panel} ${className}` : styles.panel}>
      {(title || action) && (
        <header className={styles.panelHead}>
          <div className={styles.panelTitleWrap}>
            {title && <h2 className={styles.panelTitle}>{title}</h2>}
            {description && <p className={styles.panelDesc}>{description}</p>}
          </div>
          {action && <div className={styles.panelAction}>{action}</div>}
        </header>
      )}
      <div className={flush ? styles.panelBodyFlush : styles.panelBody}>{children}</div>
    </section>
  );
}

/* ── Segmented control ───────────────────────────────────── */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label?: string;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segment}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ── Pills ───────────────────────────────────────────────── */

export function Pill({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span className={styles.pill} data-tone={tone}>
      {dot && <span className={styles.pillDot} />}
      {children}
    </span>
  );
}

/* ── Empty states ────────────────────────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={styles.empty}>
      {Icon && (
        <span className={styles.emptyIcon}>
          <Icon size={19} />
        </span>
      )}
      <p className={styles.emptyTitle}>{title}</p>
      {description && <p className={styles.emptyDesc}>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

/* ── Button class helpers ────────────────────────────────── */

export const buttonClass = {
  primary: `${styles.btn} ${styles.btnPrimary}`,
  secondary: `${styles.btn} ${styles.btnSecondary}`,
  ghost: `${styles.btn} ${styles.btnGhost}`,
  danger: `${styles.btn} ${styles.btnDanger}`,
};

export const layout = {
  split: styles.split,
  sectionLabel: styles.sectionLabel,
};
