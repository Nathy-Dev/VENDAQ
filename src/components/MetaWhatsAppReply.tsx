"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Workspace, WorkspaceContact } from "@/types/workspace";
import { buttonClass } from "./dashboard-ui";
import styles from "./FoundationWorkspace.module.css";

const statusText = {
  queued: "Sending to WhatsApp…", accepted: "Accepted by Meta. Awaiting delivery.", sent: "Sent to WhatsApp.", delivered: "Delivered.", read: "Read.",
  failed: "Meta reported a send or delivery failure. Check WhatsApp before trying again.",
  unknown: "WhatsApp did not confirm delivery. Check the chat in WhatsApp before sending anything else.",
  cancelled: "This reply was not sent because eligibility changed. Check the connection and reply window.",
};

export default function MetaWhatsAppReply({ workspace, contact }: { workspace: Workspace; contact: WorkspaceContact }) {
  const args = { businessId: workspace.businessId, customerId: contact.customerId };
  const info = useQuery(api.assistantReply.sellerReplyInfo, args);
  const send = useMutation(api.assistantReply.queueSellerReply);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [expiredWindow, setExpiredWindow] = useState<number | null>(null);
  const inFlight = useRef(false);
  const request = useRef<{ id: string; content: string } | null>(null);
  const expiresAt = info?.expiresAt;

  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(() => setExpiredWindow(expiresAt), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  const eligible = !!expiresAt && expiredWindow !== expiresAt;
  const blocked = busy || info?.latest === "queued" || info?.latest === "unknown";

  async function submit() {
    const content = draft.trim();
    if (!eligible || blocked || !content || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    if (request.current?.content !== content) request.current = { id: crypto.randomUUID(), content };
    try {
      await send({ ...args, requestId: request.current.id, content });
      request.current = null;
      setDraft("");
    } catch { setError(true); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className={styles.detailsBody}>
    {eligible ? <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className={styles.field}>Reply via WhatsApp<textarea className={`${styles.input} ${styles.textarea}`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4096} disabled={blocked} /></label>
      <div className={styles.actions}><button type="submit" className={buttonClass.primary} disabled={!draft.trim() || blocked}>Send reply</button></div>
    </form> : info && <p className={styles.helper}>Inbox replies require an eligible recent customer message and an active Meta connection. You can still reply in the WhatsApp Business app.</p>}
    {info?.latest && <p className={styles.helper} role="status">{statusText[info.latest]}</p>}
    {error && <p className={styles.helper} role="alert">Could not confirm that the reply was queued. Check WhatsApp before editing or sending a new reply.</p>}
  </div>;
}
