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
type GovernanceMode = "watch" | "suggest" | "mentions" | "common_questions" | "custom";

const modes: Array<{ value: GovernanceMode; label: string; help: string }> = [
  { value: "watch", label: "Watch only", help: "Find opportunities, but never reply." },
  { value: "suggest", label: "Suggest replies", help: "Prepare opportunities for you to handle." },
  { value: "mentions", label: "Reply when mentioned", help: "Reply only when someone tags your business." },
  { value: "common_questions", label: "Answer common questions", help: "Reply to clear questions and mentions." },
  { value: "custom", label: "Custom safeguards", help: "Use your own simple group instructions." },
];

export default function WorkspaceGroups({ workspace }: { workspace: Workspace }) {
  const groups = useQuery(api.groups.list, { businessId: workspace.businessId });
  const profile = useQuery(api.businessProfile.get, { businessId: workspace.businessId });
  const setEnabled = useMutation(api.groups.setEnabled);
  const setGovernance = useMutation(api.groups.setGovernance);
  const [filter, setFilter] = useState<GroupFilter>("managed");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const visible = useMemo(() => (groups ?? []).filter((group) => filter === "all" || (filter === "managed" ? group.role === "owner" || group.role === "admin" : group.role === "member")), [filter, groups]);
  const ready = workspace.state === "connected" && workspace.hasBusinessSystemPrompt && (profile?.groupAutoReplyEnabled ?? false);

  async function toggle(groupJid: string, enabled: boolean) { setBusy(groupJid); setFeedback(null); try { await setEnabled({ businessId: workspace.businessId, groupJid, isEnabled: enabled }); } catch { setFeedback({ text: "We couldn't update that group. Complete the business AI brief and group authorization first.", error: true }); } finally { setBusy(null); } }
  async function govern(groupJid: string, mode: GovernanceMode, allowPrivateHandoff: boolean, customInstructions = "") { setBusy(groupJid); setFeedback(null); try { await setGovernance({ businessId: workspace.businessId, groupJid, mode, allowPrivateHandoff, customInstructions }); } catch { setFeedback({ text: "We couldn't save those group safeguards. If you chose custom, add a short instruction first.", error: true }); } finally { setBusy(null); } }

  return <section className={`${styles.card} ${styles.groupsCard}`}><div className={styles.sectionHeading}><div><h2>Groups & communities</h2><p>Choose each group and the simple level of help Pipelixr may provide. Every group starts silent.</p></div><UsersRound size={18} aria-hidden="true" /></div>{!ready && <div className={styles.infoBanner}><ShieldCheck size={17} /><p>Before enabling a group: connect WhatsApp, save your business information, and authorize group replies.</p></div>}<div className={styles.toolbar}><Segmented value={filter} onChange={setFilter} label="Filter WhatsApp groups" options={[{ value: "managed", label: "Groups I manage" }, { value: "member", label: "Groups I belong to" }, { value: "all", label: "All groups" }]} /><Pill dot>Synced automatically</Pill></div><Notice feedback={feedback} />{groups === undefined ? <div className={styles.loading} role="status">Loading groups…</div> : visible.length === 0 ? <EmptyState icon={UsersRound} title={filter === "managed" ? "No owned or admin groups found" : filter === "member" ? "No member-only groups found" : "No groups found"} description="Pipelixr keeps this list synchronized with the connected WhatsApp account." /> : <div className={styles.groupList}>{visible.map((group) => <article key={group.groupJid} className={styles.groupRow}><div className={styles.groupInfo}><div className={styles.groupTitleRow}><strong>{group.groupName}</strong><Pill tone={group.role === "member" ? "neutral" : "violet"}>{group.role === "owner" ? "Owner" : group.role === "admin" ? "Admin" : "Member"}</Pill></div><p>{group.memberCount ? `${group.memberCount} members · ` : ""}{group.isEnabled ? modes.find((mode) => mode.value === group.governanceMode)?.help : "Pipelixr is silent here"}</p>{group.isEnabled && <div className={styles.groupPolicy}><label className={styles.field}>How Pipelixr should help<select className={styles.input} value={group.governanceMode} disabled={busy !== null} onChange={(event) => void govern(group.groupJid, event.target.value as GovernanceMode, group.allowPrivateHandoff, group.customInstructions)}>{modes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>{group.governanceMode === "custom" && <label className={styles.field}>Simple group rule<input className={styles.input} defaultValue={group.customInstructions} placeholder="Example: Only answer delivery questions" onBlur={(event) => void govern(group.groupJid, "custom", group.allowPrivateHandoff, event.target.value)} /></label>}<label className={styles.compactCheck}><input type="checkbox" checked={group.allowPrivateHandoff} disabled={busy !== null} onChange={(event) => void govern(group.groupJid, group.governanceMode, event.target.checked, group.customInstructions)} />Allow private handoff after the person agrees</label></div>}</div><div className={styles.groupControls}><button type="button" className={group.isEnabled ? buttonClass.danger : buttonClass.primary} disabled={busy !== null || (!group.isEnabled && !ready)} onClick={() => void toggle(group.groupJid, !group.isEnabled)}>{busy === group.groupJid ? "Saving…" : group.isEnabled ? "Disable" : "Enable"}</button></div></article>)}</div>}</section>;
}
