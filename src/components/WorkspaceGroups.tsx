"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ShieldCheck, UsersRound } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { buttonClass, EmptyState, Pill, Segmented } from "./dashboard-ui";
import { Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

type GroupFilter = "managed" | "member" | "all";

export default function WorkspaceGroups({ workspace }: { workspace: Workspace }) {
  const groups = useQuery(api.groups.list, { businessId: workspace.businessId });
  const profile = useQuery(api.businessProfile.get, { businessId: workspace.businessId });
  const setEnabled = useMutation(api.groups.setEnabled);
  const setMentionOnly = useMutation(api.groups.setMentionOnly);
  const [filter, setFilter] = useState<GroupFilter>("managed");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const visible = useMemo(() => (groups ?? []).filter((group) => filter === "all" || (filter === "managed" ? group.role === "owner" || group.role === "admin" : group.role === "member")), [filter, groups]);
  const ready = workspace.state === "connected" && workspace.hasBusinessSystemPrompt && (profile?.groupAutoReplyEnabled ?? false);

  async function toggle(groupJid: string, enabled: boolean) {
    setBusy(groupJid); setFeedback(null);
    try { await setEnabled({ businessId: workspace.businessId, groupJid, isEnabled: enabled }); }
    catch { setFeedback({ text: "We couldn't update that group. Complete the business AI brief and group authorization first.", error: true }); }
    finally { setBusy(null); }
  }

  return <section className={`${styles.card} ${styles.groupsCard}`}>
    <div className={styles.sectionHeading}><div><h2>Groups & communities</h2><p>Choose each WhatsApp group where Pipelixr is allowed to interact. All groups are silent by default.</p></div><UsersRound size={18} aria-hidden="true" /></div>
    {!ready && <div className={styles.infoBanner}><ShieldCheck size={17} /><p>Before enabling a group: connect WhatsApp, save the business system prompt, and authorize group replies in Business AI.</p></div>}
    <div className={styles.toolbar}><Segmented value={filter} onChange={setFilter} label="Filter WhatsApp groups" options={[{ value: "managed", label: "Groups I manage" }, { value: "member", label: "Groups I belong to" }, { value: "all", label: "All groups" }]} /><Pill dot>Synced automatically</Pill></div>
    <Notice feedback={feedback} />
    {groups === undefined ? <div className={styles.loading} role="status">Loading groups…</div> : visible.length === 0 ? <EmptyState icon={UsersRound} title={filter === "managed" ? "No owned or admin groups found" : filter === "member" ? "No member-only groups found" : "No groups found"} description="Pipelixr keeps this list synchronized with the connected WhatsApp account." /> : <div className={styles.groupList}>{visible.map((group) => <article key={group.groupJid} className={styles.groupRow}>
      <div className={styles.groupInfo}><div className={styles.groupTitleRow}><strong>{group.groupName}</strong><Pill tone={group.role === "member" ? "neutral" : "violet"}>{group.role === "owner" ? "Owner" : group.role === "admin" ? "Admin" : "Member"}</Pill></div><p>{group.memberCount ? `${group.memberCount} members · ` : ""}{group.isEnabled ? group.mentionOnly ? "Replies only when explicitly mentioned" : "Replies to eligible messages" : "Pipelixr is silent here"}</p></div>
      <div className={styles.groupControls}>{group.isEnabled && <label className={styles.compactCheck}><input type="checkbox" checked={group.mentionOnly} disabled={busy !== null} onChange={(event) => void setMentionOnly({ businessId: workspace.businessId, groupJid: group.groupJid, mentionOnly: event.target.checked })} />Only when mentioned</label>}<button type="button" className={group.isEnabled ? buttonClass.danger : buttonClass.primary} disabled={busy !== null || (!group.isEnabled && !ready)} onClick={() => void toggle(group.groupJid, !group.isEnabled)}>{busy === group.groupJid ? "Saving…" : group.isEnabled ? "Disable" : "Enable"}</button></div>
    </article>)}</div>}
  </section>;
}
