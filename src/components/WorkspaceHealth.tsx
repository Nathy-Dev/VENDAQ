"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CircleCheck, LifeBuoy, ShieldCheck, RefreshCw } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import type { Id } from "../../convex/_generated/dataModel";
import { formatDate, titleCase } from "@/lib/workspace-ui";
import { buttonClass, EmptyState, Panel, Pill } from "./dashboard-ui";
import { LoadingRows, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

export default function WorkspaceHealth({ workspace }: { workspace: Workspace }) {
  const readiness = useQuery(api.extensions.readiness, { businessId: workspace.businessId });
  const jobs = useQuery(api.foundation.privacyJobs, { businessId: workspace.businessId });
  const failures = useQuery(api.foundation.failures, { businessId: workspace.businessId });
  const incidents = useQuery(api.productAnalytics.incidents, { businessId: workspace.businessId });
  const support = useQuery(api.productAnalytics.supportQueue, { businessId: workspace.businessId });
  const createSupportRequest = useMutation(api.productAnalytics.createSupportRequest);
  const retryDeletion = useMutation(api.foundation.retryDeletion);
  const retryEvent = useMutation(api.foundation.retryEvent);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [supportSummary, setSupportSummary] = useState("");
  const [supportDetails, setSupportDetails] = useState("");

  async function retry(kind: "deletion", id: Id<"deletionJobs">): Promise<void>;
  async function retry(kind: "event", id: Id<"inboundEvents">): Promise<void>;
  async function retry(kind: "deletion" | "event", id: Id<"deletionJobs"> | Id<"inboundEvents">) {
    if (busy) return;
    setBusy(id); setFeedback(null);
    try {
      if (kind === "deletion") await retryDeletion({ businessId: workspace.businessId, jobId: id as Id<"deletionJobs"> });
      else await retryEvent({ businessId: workspace.businessId, eventId: id as Id<"inboundEvents"> });
      setFeedback({ text: kind === "deletion" ? "Deletion retry queued. Check its progress here." : "Processing retry queued. No messages are sent." });
    } catch { setFeedback({ text: "We couldn't queue the retry. The record may have expired or changed. Please try again.", error: true }); }
    finally { setBusy(null); }
  }

  return <div className={styles.stack}>
    <section className={styles.card}>
      <div className={styles.sectionHeading}><div><h2>Privacy & retention</h2><p>Your data has a defined lifecycle.</p></div><ShieldCheck size={18} aria-hidden="true" /></div>
      <ul className={styles.noteList}><li>Eligible message content is retained for {workspace.retentionDays} days. Some non-content audit records follow separate retention rules.</li><li>Delete a contact and its workspace records from the Inbox. Deletion jobs run in the background; their progress appears below.</li><li>Deletion does not remove messages from anyone’s WhatsApp account. Never connect a number without permission.</li></ul>
    </section>
    <Panel title="Workspace health" description="A clear view of connection and processing safeguards.">
      {readiness === undefined ? <LoadingRows label="Loading workspace health" /> : <>
        <div className={styles.settingRow}><div><strong>Authorized automation</strong><p>{readiness.dispatchQualified ? "Available for the customer and group scopes you explicitly enabled." : "Paused until the connection, playbook, and authorization checks are ready."}</p></div><Pill tone={readiness.dispatchQualified ? "positive" : "neutral"}>{readiness.dispatchQualified ? "Available" : "Paused"}</Pill></div>
        <div className={styles.settingRow}><div><strong>Dispatch safety switch</strong><p>{readiness.killSwitch ? "Active. Automatic dispatch is blocked." : "Off. Daily and per-recipient rollout limits still apply."}</p></div><Pill>{readiness.killSwitch ? "Active" : "Off"}</Pill></div>
        <div className={styles.settingRow}><div><strong>Recent health events</strong><p>{readiness.warning ? "Processing or connection issues need attention." : "Events include provider errors and exhausted processing retries."}</p></div><Pill tone={readiness.warning ? "warning" : "neutral"}>{readiness.recentRiskEvents}</Pill></div>
        <details className={styles.details}><summary>Health details</summary><ul className={styles.noteList}>{readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
      </>}
    </Panel>
    <Panel title="Connection health and fallback" description="Pipelixr monitors the connection and records interruptions automatically.">
      {incidents === undefined ? <LoadingRows label="Loading connection incidents" /> : incidents.length === 0 ? <EmptyState icon={CircleCheck} title="No connection incidents recorded" description="If the provider connection drops or reports an error, the incident appears here." /> : <ul className={styles.auditList}>{incidents.map((incident) => <li key={incident.id}><div className={styles.settingRow}><div><strong>{titleCase(incident.kind)}</strong><p>{incident.code ?? "Connection state changed"} · {formatDate(incident.startedAt, workspace.timezone)}</p></div><Pill tone={incident.status === "active" ? "danger" : "positive"}>{titleCase(incident.status)}</Pill></div></li>)}</ul>}
      <div className={styles.infoBanner}><ShieldCheck size={17} /><p>If sending is uncertain or the connection is unavailable, check the customer chat in WhatsApp before sending manually. Pipelixr never retries an uncertain send automatically.</p></div>
    </Panel>
    <Panel title="Contact support" description="Create a structured incident report with your workspace already attached.">
      <form className={styles.form} onSubmit={async (event) => { event.preventDefault(); if (busy) return; setBusy("support"); setFeedback(null); try { await createSupportRequest({ businessId: workspace.businessId, category: workspace.state === "connected" ? "other" : "connection", severity: "normal", summary: supportSummary, details: supportDetails }); setSupportSummary(""); setSupportDetails(""); setFeedback({ text: "Support request recorded. An operator can now review it in the admin console." }); } catch { setFeedback({ text: "We couldn't record that support request. Add a short summary and more detail, then retry.", error: true }); } finally { setBusy(null); } }}><label className={styles.field}>Short summary<input className={styles.input} minLength={5} maxLength={120} required value={supportSummary} onChange={(event) => setSupportSummary(event.target.value)} placeholder="e.g. WhatsApp disconnected twice today" /></label><label className={styles.field}>What happened?<textarea className={`${styles.input} ${styles.textarea}`} minLength={10} maxLength={2000} required value={supportDetails} onChange={(event) => setSupportDetails(event.target.value)} placeholder="Include when it happened and what you saw. Do not paste passwords, tokens, card data, or private customer content." /></label><div className={styles.formFooter}><button className={buttonClass.primary} disabled={busy !== null}><LifeBuoy size={14} />{busy === "support" ? "Sending…" : "Send support request"}</button></div></form>
      {support && support.length > 0 && <ul className={styles.auditList}>{support.slice(0, 5).map((request) => <li key={request.id}><strong>{request.summary}</strong><p>{titleCase(request.status)} · {formatDate(request.createdAt, workspace.timezone)}</p></li>)}</ul>}
    </Panel>
    <Notice feedback={feedback} />
    <Panel title="Deletion requests" description="The 20 most recent requests and their actual processing state.">
      {jobs === undefined ? <LoadingRows label="Loading deletion requests" /> : jobs.length === 0 ? <EmptyState icon={ShieldCheck} title="No deletion requests" description="Requests appear here after you delete a contact from your workspace." /> : <ul className={styles.auditList}>{jobs.map((job) => <li key={job.jobId}><div className={styles.settingRow}><div><strong>{job.state === "dead_letter" ? "Deletion needs a retry" : job.state === "done" ? "Deletion complete" : "Deletion in progress"}</strong><p>Requested {formatDate(job.requestedAt, workspace.timezone)}</p></div><Pill tone={job.state === "done" ? "positive" : job.state === "dead_letter" ? "danger" : "neutral"}>{job.state === "dead_letter" ? "Needs attention" : titleCase(job.state)}</Pill></div>{job.state === "dead_letter" && <div className={styles.actions}><button type="button" className={buttonClass.secondary} disabled={busy !== null} onClick={() => void retry("deletion", job.jobId)}><RefreshCw size={13} aria-hidden="true" />{busy === job.jobId ? "Retrying…" : "Retry deletion"}</button></div>}</li>)}</ul>}
    </Panel>
    <Panel title="Processing issues" description="Recent messages that couldn't be processed. Retriable records keep their safeguards.">
      {failures === undefined ? <LoadingRows label="Loading processing issues" /> : failures.length === 0 ? <EmptyState icon={CircleCheck} title="No processing issues reported" description="Exhausted processing retries appear here if they need your attention." /> : <ul className={styles.auditList}>{failures.map((failure) => <li key={failure.eventId}><strong>Message processing failed</strong><p>{formatDate(failure.receivedAt, workspace.timezone)} · {failure.attempts} attempts</p><div className={styles.actions}><button type="button" className={buttonClass.secondary} disabled={busy !== null || !failure.retryable} onClick={() => void retry("event", failure.eventId)}><RefreshCw size={13} aria-hidden="true" />{busy === failure.eventId ? "Retrying…" : failure.retryable ? "Retry processing" : "Content unavailable"}</button></div><details className={styles.details}><summary>Support reference</summary><p className={styles.helper}>Reference: {failure.correlationId}<br />Code: {failure.code}</p></details></li>)}</ul>}
    </Panel>
  </div>;
}
