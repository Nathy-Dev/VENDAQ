"use client";

import { useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Download, FileLock2, ShieldAlert } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { formatDate, titleCase } from "@/lib/workspace-ui";
import { buttonClass, Pill } from "./dashboard-ui";
import { Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

type RequestType = "access" | "correction" | "restriction" | "objection" | "erasure";

export default function PrivacyCenter({ workspace }: { workspace: Workspace }) {
  const requests = useQuery(api.compliance.privacyRequests, { businessId: workspace.businessId });
  const deletion = useQuery(api.compliance.deletionStatus, { businessId: workspace.businessId });
  const exportWorkspace = useQuery(api.compliance.exportWorkspace, { businessId: workspace.businessId });
  const createRequest = useMutation(api.compliance.createPrivacyRequest);
  const requestDeletion = useAction(api.compliance.requestAccountDeletion);
  const [requestType, setRequestType] = useState<RequestType>("access");
  const [details, setDetails] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<"request" | "delete" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const exportJson = useMemo(() => exportWorkspace ? JSON.stringify(exportWorkspace, null, 2) : null, [exportWorkspace]);

  function downloadExport() {
    if (!exportJson) return;
    const url = URL.createObjectURL(new Blob([exportJson], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `pipelixr-${workspace.businessId}-export.json`; link.click(); URL.revokeObjectURL(url);
  }

  return <div className={styles.stack}>
    <section className={styles.card}>
      <div className={styles.sectionHeading}><div><h2>Privacy center</h2><p>Export data, record a rights request, or permanently delete this account.</p></div><FileLock2 size={18} /></div>
      <div className={styles.infoBanner}><Download size={17} /><p>Your JSON export contains up to 500 customers, 500 orders, and 2,000 messages. The file tells you if a collection was truncated. Store it securely.</p></div>
      <div className={styles.actions}><button type="button" className={buttonClass.secondary} disabled={!exportJson} onClick={downloadExport}>{exportJson ? "Download workspace JSON" : "Preparing export…"}</button></div>
    </section>
    <section className={styles.card}>
      <div className={styles.sectionHeading}><div><h2>Data-rights requests</h2><p>Requests are recorded with a 30-day target date and reviewed under applicable law.</p></div></div>
      <form className={styles.form} onSubmit={async (event) => { event.preventDefault(); if (busy) return; setBusy("request"); setFeedback(null); try { await createRequest({ businessId: workspace.businessId, requestType, ...(details.trim() ? { details: details.trim() } : {}) }); setDetails(""); setFeedback({ text: "Privacy request recorded." }); } catch { setFeedback({ text: "The request could not be recorded. Try again.", error: true }); } finally { setBusy(null); } }}>
        <label className={styles.field}>Request type<select className={styles.input} value={requestType} onChange={(event) => setRequestType(event.target.value as RequestType)}><option value="access">Access</option><option value="correction">Correction</option><option value="restriction">Restriction</option><option value="objection">Objection</option><option value="erasure">Erasure</option></select></label>
        <label className={styles.field}>Details<textarea className={`${styles.input} ${styles.textarea}`} maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Describe the records, correction, or processing involved." /></label>
        <div className={styles.formFooter}><button className={buttonClass.primary} disabled={busy !== null}>{busy === "request" ? "Submitting…" : "Submit request"}</button></div>
      </form>
      <Notice feedback={feedback} />
      {requests === undefined ? <p className={styles.helper}>Loading requests…</p> : requests.length > 0 && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Request</th><th>Status</th><th>Submitted</th><th>Target date</th></tr></thead><tbody>{requests.map((request) => <tr key={request.requestId}><td>{titleCase(request.requestType)}</td><td><Pill tone={request.status === "completed" ? "positive" : "neutral"}>{titleCase(request.status)}</Pill></td><td>{formatDate(request.requestedAt, workspace.timezone)}</td><td>{formatDate(request.dueAt, workspace.timezone)}</td></tr>)}</tbody></table></div>}
    </section>
    <section className={`${styles.card} ${styles.dangerZone}`}>
      <div className={styles.sectionHeading}><div><h2>Delete account and workspace</h2><p>This begins permanent background deletion and cancels an active subscription before data removal.</p></div><ShieldAlert size={18} /></div>
      {deletion ? <div className={styles.infoBanner}><ShieldAlert size={17} /><p>Deletion state: <strong>{titleCase(deletion.state)}</strong>. {deletion.deletedRecords} records removed.{deletion.errorCode ? ` Operator attention is required: ${deletion.errorCode}.` : ""}</p></div> : <>
        <p className={styles.helper}>Download an export first. Deletion disables the workspace immediately, disconnects the provider, removes stored records in batches, and cannot be undone. Type <strong>{workspace.name}</strong> exactly to confirm.</p>
        <label className={styles.field}>Business name confirmation<input className={styles.input} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
        <div className={styles.actions}><button type="button" className={buttonClass.danger} disabled={busy !== null || confirmation !== workspace.name} onClick={async () => { if (!window.confirm("Permanently delete this account and workspace? This cannot be undone.")) return; setBusy("delete"); setFeedback(null); try { await requestDeletion({ businessId: workspace.businessId, confirmation }); await signOut({ callbackUrl: "/" }); } catch { setFeedback({ text: "Deletion could not be started. Check the confirmation or contact support.", error: true }); setBusy(null); } }}>{busy === "delete" ? "Starting deletion…" : "Permanently delete account"}</button></div>
      </>}
    </section>
  </div>;
}
