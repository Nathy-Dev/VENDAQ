"use client";

import { useEffect, useId, useRef } from "react";
import { Check, CircleAlert } from "lucide-react";
import { buttonClass } from "./dashboard-ui";
import styles from "./FoundationWorkspace.module.css";

export type Feedback = { text: string; error?: boolean } | null;

export function Notice({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const Icon = feedback.error ? CircleAlert : Check;
  return <div className={styles.notice} data-error={feedback.error} role={feedback.error ? "alert" : "status"}><Icon size={15} aria-hidden="true" /><span>{feedback.text}</span></div>;
}

export function LoadingRows({ label = "Loading workspace data" }: { label?: string }) {
  return <div className={styles.skeletonGrid} role="status" aria-label={label}><span className="sr-only">{label}</span>{[0, 1, 2].map((row) => <div key={row} className={styles.skeleton} aria-hidden="true" />)}</div>;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, busy = false, danger = true }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; description: string; confirmLabel: string; busy?: boolean; danger?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={dialogRef} className={styles.modal} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
      <h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p>
      <div className={styles.actions}>
        <button type="button" autoFocus className={buttonClass.secondary} disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className={danger ? buttonClass.danger : buttonClass.primary} disabled={busy} onClick={onConfirm}>{busy ? "Saving…" : confirmLabel}</button>
      </div>
    </dialog>
  );
}
