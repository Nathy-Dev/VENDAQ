"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { PageHeader, buttonClass } from "./dashboard-ui";
import { Notice, type Feedback } from "./WorkspaceFeedback";
import ConnectionPanel from "./WorkspaceConnection";
import { ExtensionPreferences } from "./WorkspaceAccount";
import FollowUpRules from "./WorkspaceFollowUpRules";
import WorkspaceHealth from "./WorkspaceHealth";
import styles from "./FoundationWorkspace.module.css";

export { default as ConnectionPanel } from "./WorkspaceConnection";
export { ViewersPanel, ProfilePanel } from "./WorkspaceAccount";

const sections = [
  { value: "general", label: "General" },
  { value: "connection", label: "Connection" },
  { value: "rules", label: "Follow-up rules" },
  { value: "privacy", label: "Privacy & health" },
  { value: "preferences", label: "Preferences" },
] as const;

export default function WorkspaceSettings({ workspace }: { workspace: Workspace }) {
  const [section, setSection] = useState<(typeof sections)[number]["value"]>("general");
  return (
    <div className={styles.stack}>
      <PageHeader title="Settings" description="A few clear controls for the way you work." />
      <div className={styles.settingsLayout}>
        <nav className={styles.settingsNav} aria-label="Settings sections">{sections.map((entry) => <button type="button" key={entry.value} aria-pressed={section === entry.value} onClick={() => setSection(entry.value)}>{entry.label}</button>)}</nav>
        <div className={styles.stack}>
          {section === "general" && <GeneralSettings workspace={workspace} />}
          {section === "connection" && <ConnectionPanel workspace={workspace} />}
          {section === "rules" && <FollowUpRules workspace={workspace} />}
          {section === "privacy" && <WorkspaceHealth workspace={workspace} />}
          {section === "preferences" && <ExtensionPreferences workspace={workspace} />}
        </div>
      </div>
    </div>
  );
}

function GeneralSettings({ workspace }: { workspace: Workspace }) {
  const update = useMutation(api.readOnly.setResponseWindow);
  const [windowMinutes, setWindowMinutes] = useState(String(workspace.responseWindowMinutes));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  return <>
    <section className={styles.card}>
      <div className={styles.sectionHeading}><div><h2>Business details</h2><p>The essentials behind this workspace.</p></div></div>
      <dl className={styles.profileDetails}><div><dt>Business name</dt><dd>{workspace.name}</dd></div><div><dt>Timezone</dt><dd>{workspace.timezone.replaceAll("_", " ")}</dd></div><div><dt>Message retention</dt><dd>{workspace.retentionDays} days</dd></div><div><dt>Sending mode</dt><dd>Manual, in WhatsApp</dd></div></dl>
    </section>
    <section className={styles.card}>
      <div className={styles.sectionHeading}><div><h2>Response window</h2><p>When an unanswered buying signal should be considered overdue.</p></div></div>
      <form className={styles.form} onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const responseWindowMinutes = Number(windowMinutes);
        if (!Number.isInteger(responseWindowMinutes) || responseWindowMinutes < 15 || responseWindowMinutes > 1440) { setFeedback({ text: "Choose a whole number between 15 and 1,440 minutes.", error: true }); return; }
        setBusy(true); setFeedback(null);
        try { await update({ businessId: workspace.businessId, responseWindowMinutes }); setFeedback({ text: "Response window saved for new buying signals." }); }
        catch { setFeedback({ text: "We couldn't save the response window. Please try again.", error: true }); }
        finally { setBusy(false); }
      }}>
        <label className={styles.field}>Minutes before overdue<input className={styles.input} type="number" min="15" max="1440" step="1" required value={windowMinutes} disabled={busy} onChange={(event) => setWindowMinutes(event.target.value)} /><span className={styles.fieldHelp}>15 minutes to 24 hours. Existing signals keep their recorded response window.</span></label>
        <Notice feedback={feedback} /><div className={styles.formFooter}><button type="submit" className={buttonClass.primary} disabled={busy || Number(windowMinutes) === workspace.responseWindowMinutes}>{busy ? "Saving…" : "Save changes"}</button></div>
      </form>
    </section>
    <div className={styles.infoBanner}><ShieldCheck size={17} aria-hidden="true" /><p>Opening a conversation here never sends a reply or marks it read in WhatsApp. Follow-up drafts need your review and a manual send.</p></div>
  </>;
}
