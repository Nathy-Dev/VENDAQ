"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useMutation, useQuery } from "convex/react";
import { Eye, Settings, ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { formatDate, initials, titleCase } from "@/lib/workspace-ui";
import { buttonClass, EmptyState, PageHeader, Panel, Pill } from "./dashboard-ui";
import { LoadingRows, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

export function ViewersPanel({ workspace }: { workspace: Workspace }) {
  return <ExtensionPreferences workspace={workspace} showViewers />;
}

export function ExtensionPreferences({ workspace, showViewers = false }: { workspace: Workspace; showViewers?: boolean }) {
  const settings = useQuery(api.extensions.settings, { businessId: workspace.businessId });
  const observations = useQuery(api.extensions.statusViewers, showViewers && settings?.statusViewerListEnabled ? { businessId: workspace.businessId } : "skip");
  const update = useMutation(api.extensions.updateSettings);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function change(field: "statusViewerListEnabled" | "automatedSendingRequested", value: boolean) {
    if (!settings || busy) return;
    setBusy(true); setFeedback(null);
    try {
      await update({ businessId: workspace.businessId, statusViewerListEnabled: settings.statusViewerListEnabled, automatedSendingRequested: settings.automatedSendingRequested, [field]: value });
      setFeedback({ text: field === "statusViewerListEnabled" ? `Status observations ${value ? "enabled" : "disabled"}. No contacts or follow-ups are created.` : "Preference saved. Automated sending remains disabled." });
    } catch { setFeedback({ text: "We couldn't save this preference. Please try again.", error: true }); }
    finally { setBusy(false); }
  }

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.sectionHeading}><div><h2>{showViewers ? "Status observations" : "Workspace preferences"}</h2><p>Optional features. No hidden actions.</p></div><Eye size={18} aria-hidden="true" /></div>
        {settings === undefined ? <LoadingRows label="Loading preferences" /> : <>
          <div className={styles.settingRow}><label className={styles.checkLabel}><input type="checkbox" role="switch" checked={settings.statusViewerListEnabled} disabled={busy} onChange={(event) => void change("statusViewerListEnabled", event.target.checked)} /><span><strong>Record Status observations</strong><p>Show provider-reported views using private, hashed identity keys. These are observations, not verified people or leads.</p></span></label></div>
          {!showViewers && <div className={styles.settingRow}><label className={styles.checkLabel}><input type="checkbox" role="switch" checked={settings.automatedSendingRequested} disabled={busy} onChange={(event) => void change("automatedSendingRequested", event.target.checked)} /><span><strong>Interested in future automatic sending</strong><p>This records product interest only. It does not enable sending, schedule outreach, or change the manual-first workflow.</p></span></label></div>}
        </>}
        {feedback && <div className={styles.actions}><Notice feedback={feedback} /></div>}
      </section>
      {showViewers && <>
        <div className={styles.infoBanner}><ShieldCheck size={17} aria-hidden="true" /><p>Viewer keys are private hashes, not phone numbers. Repeated observations do not establish unique people. Viewing this list never creates leads or triggers messages.</p></div>
        <Panel title="Recent observations" description="Up to 100 provider-reported records. Identity is deliberately kept private." flush>
          {settings === undefined ? <LoadingRows label="Loading Status preferences" /> : !settings.statusViewerListEnabled ? <EmptyState icon={Eye} title="Status observations are off" description="Enable the preference above if you want to keep an observation list." /> : observations === undefined ? <LoadingRows label="Loading Status observations" /> : observations.length === 0 ? <EmptyState icon={Eye} title="Nothing observed yet" description="New eligible provider events appear here when the connected number receives them." /> : <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Recent private WhatsApp Status observations</caption><thead><tr><th scope="col">Private viewer key</th><th scope="col">Status reference</th><th scope="col">Observed</th></tr></thead><tbody>{observations.map((entry) => <tr key={entry.observationId}><td><span className={styles.viewerKey}>{entry.opaqueViewerKey}</span></td><td><span className={styles.viewerKey}>{entry.statusMessageId}</span></td><td>{formatDate(entry.observedAt, workspace.timezone)}</td></tr>)}</tbody></table></div>}
        </Panel>
      </>}
    </div>
  );
}

export function ProfilePanel({ workspace }: { workspace: Workspace }) {
  const { data: session } = useSession();
  const name = session?.user?.name || "Your account";
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  return (
    <div className={styles.stack}>
      <PageHeader title="Your profile" description="Your account and the business connected to it." />
      <section className={`${styles.card} ${styles.profileCard}`}>
        <div className={styles.profileHeader}>
          <span className={`${styles.avatar} ${styles.largeAvatar}`} aria-hidden="true">{initials(name)}</span>
          <div><h2>{name}</h2><p>{session?.user?.email || "No email available"}</p><Link href="/settings" className={buttonClass.secondary}><Settings size={14} aria-hidden="true" />Workspace settings</Link></div>
        </div>
        <dl className={styles.profileDetails}>
          <div><dt>Business</dt><dd>{workspace.name}</dd></div>
          <div><dt>WhatsApp</dt><dd><Pill dot tone={workspace.state === "connected" ? "positive" : "neutral"}>{titleCase(workspace.state)}</Pill></dd></div>
          <div><dt>Timezone</dt><dd>{workspace.timezone.replaceAll("_", " ")}</dd></div>
          <div><dt>Message retention</dt><dd>{workspace.retentionDays} days</dd></div>
        </dl>
        <div className={styles.details}><p className={styles.helper}>Account details come from your sign-in provider. Manage your connection, follow-up rules, and privacy controls in Settings.</p><div className={styles.actions}><button type="button" className={buttonClass.ghost} disabled={busy} onClick={async () => { if (busy) return; setBusy(true); try { await signOut({ callbackUrl: "/login" }); } catch { setFeedback({ text: "We couldn't sign you out. Please try again.", error: true }); setBusy(false); } }}>{busy ? "Signing out…" : "Sign out"}</button></div></div>
        <Notice feedback={feedback} />
      </section>
    </div>
  );
}
