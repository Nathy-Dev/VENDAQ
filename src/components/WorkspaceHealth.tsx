"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CircleCheck, ShieldCheck, RefreshCw } from "lucide-react";
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
  const retryDeletion = useMutation(api.foundation.retryDeletion);
  const retryEvent = useMutation(api.foundation.retryEvent);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

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
        <div className={styles.settingRow}><div><strong>Automatic sending</strong><p>Not qualified for this deployment. All replies remain manual.</p></div><Pill>Disabled</Pill></div>
        <div className={styles.settingRow}><div><strong>Dispatch safety switch</strong><p>{readiness.killSwitch ? "Active. Automatic dispatch is blocked." : "The switch is off; provider qualification still blocks automatic dispatch."}</p></div><Pill>{readiness.killSwitch ? "Active" : "Off"}</Pill></div>
        <div className={styles.settingRow}><div><strong>Recent risk events</strong><p>{readiness.warning ? "Processing or connection issues need attention." : "Events include provider errors and exhausted processing retries."}</p></div><Pill tone={readiness.warning ? "warning" : "neutral"}>{readiness.recentRiskEvents}</Pill></div>
        <details className={styles.details}><summary>Qualification details</summary><ul className={styles.noteList}>{readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
      </>}
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
