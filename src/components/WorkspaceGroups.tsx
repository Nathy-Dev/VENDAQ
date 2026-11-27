"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ShieldCheck, UsersRound } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { buttonClass, EmptyState, Pill, Segmented } from "./dashboard-ui";
import { Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";
import { customSafeguardsReady, groupSafeguardSelection, MIN_CUSTOM_INSTRUCTION_LENGTH, type GovernanceMode } from "@/lib/groupSafeguards";

type GroupFilter = "managed" | "member" | "all";
type CustomDraft = { groupJid: string; instructions: string; allowPrivateHandoff: boolean } | null;

const modes: Array<{ value: GovernanceMode; label: string; help: string }> = [
  { value: "watch", label: "Watch only", help: "Find opportunities, but never reply." },
  { value: "suggest", label: "Suggest replies", help: "Prepare opportunities for you to handle." },
  { value: "mentions", label: "Reply when mentioned", help: "Reply only when someone tags your business." },
  { value: "common_questions", label: "Answer common questions", help: "Reply to clear questions and mentions." },
  { value: "custom", label: "Custom safeguards", help: "Use your own simple group instructions." },
];

export default function WorkspaceGroups({ workspace, embedded = false }: { workspace: Workspace; embedded?: boolean }) {
  const groups = useQuery(api.groups.list, { businessId: workspace.businessId });
  const profile = useQuery(api.businessProfile.get, { businessId: workspace.businessId });
  const setEnabled = useMutation(api.groups.setEnabled);
  const setGovernance = useMutation(api.groups.setGovernance);
  const [filter, setFilter] = useState<GroupFilter>("managed");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [customDraft, setCustomDraft] = useState<CustomDraft>(null);
  const visible = useMemo(() => (groups ?? []).filter((group) => filter === "all" || (filter === "managed" ? group.role === "owner" || group.role === "admin" : group.role === "member")), [filter, groups]);
  const ready = workspace.state === "connected" && workspace.hasBusinessSystemPrompt && (profile?.groupAutoReplyEnabled ?? false);

  async function toggle(groupJid: string, enabled: boolean) {
    setBusy(groupJid);
    setFeedback(null);
    try {
      await setEnabled({ businessId: workspace.businessId, groupJid, isEnabled: enabled });
    } catch {
      setFeedback({ text: "We couldn't update that group. Complete Teach Pipelixr and group authorization first.", error: true });
    } finally {
      setBusy(null);
    }
  }

  async function govern(groupJid: string, mode: GovernanceMode, allowPrivateHandoff: boolean, customInstructions = "") {
    setBusy(groupJid);
    setFeedback(null);
    try {
      await setGovernance({ businessId: workspace.businessId, groupJid, mode, allowPrivateHandoff, customInstructions });
      setCustomDraft((draft) => draft?.groupJid === groupJid ? null : draft);
      setFeedback({ text: mode === "custom" ? "Custom safeguards saved." : "Group safeguards updated." });
    } catch {
      setFeedback({ text: "We couldn't save those group safeguards. Please retry.", error: true });
    } finally {
      setBusy(null);
    }
  }

  function chooseMode(group: NonNullable<typeof groups>[number], mode: GovernanceMode) {
    setFeedback(null);
    const selection = groupSafeguardSelection(mode, group.customInstructions, group.allowPrivateHandoff);
    if (selection.kind === "draft") {
      setCustomDraft({ groupJid: group.groupJid, instructions: selection.instructions, allowPrivateHandoff: selection.allowPrivateHandoff });
      return;
    }
    setCustomDraft((draft) => draft?.groupJid === group.groupJid ? null : draft);
    void govern(group.groupJid, selection.mode, selection.allowPrivateHandoff, selection.customInstructions);
  }

  function updateDraft(groupJid: string, changes: Partial<NonNullable<CustomDraft>>) {
    setCustomDraft((draft) => draft?.groupJid === groupJid ? { ...draft, ...changes } : draft);
  }

  return (
    <section className={embedded ? styles.setupPanel : `${styles.card} ${styles.groupsCard}`}>
      <div className={styles.sectionHeading}>
        <div><h2>Groups & communities</h2><p>Choose each group and the simple level of help Pipelixr may provide. Every group starts silent.</p></div>
        <UsersRound size={18} aria-hidden="true" />
      </div>
      {!ready && <div className={styles.infoBanner}><ShieldCheck size={17} /><p>Before enabling a group: connect WhatsApp, save your business information, and authorize group replies.</p></div>}
      <div className={styles.toolbar}>
        <Segmented value={filter} onChange={setFilter} label="Filter WhatsApp groups" options={[{ value: "managed", label: "Groups I manage" }, { value: "member", label: "Groups I belong to" }, { value: "all", label: "All groups" }]} />
        <Pill dot>Synced automatically</Pill>
      </div>
      <Notice feedback={feedback} />
      {groups === undefined ? <div className={styles.loading} role="status">Loading groups…</div> : visible.length === 0 ? (
        <EmptyState icon={UsersRound} title={filter === "managed" ? "No owned or admin groups found" : filter === "member" ? "No member-only groups found" : "No groups found"} description="Pipelixr keeps this list synchronized with the connected WhatsApp account." />
      ) : (
        <div className={styles.groupList}>
          {visible.map((group) => {
            const draft = customDraft?.groupJid === group.groupJid ? customDraft : null;
            const selectedMode = draft ? "custom" : group.governanceMode;
            const canSaveCustom = draft ? customSafeguardsReady(draft.instructions) : false;
            return (
              <article key={group.groupJid} className={styles.groupRow}>
                <div className={styles.groupInfo}>
                  <div className={styles.groupTitleRow}>
                    <strong>{group.groupName}</strong>
                    <Pill tone={group.role === "member" ? "neutral" : "violet"}>{group.role === "owner" ? "Owner" : group.role === "admin" ? "Admin" : "Member"}</Pill>
                  </div>
                  <p>{group.memberCount ? `${group.memberCount} members · ` : ""}{group.isEnabled ? modes.find((mode) => mode.value === selectedMode)?.help : "Pipelixr is silent here"}</p>
                  {group.isEnabled && <div className={styles.groupPolicy}>
                    <label className={styles.field}>How Pipelixr should help
                      <select className={styles.input} value={selectedMode} disabled={busy !== null} onChange={(event) => chooseMode(group, event.target.value as GovernanceMode)}>
                        {modes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                      </select>
                    </label>
                    {draft && <div className={styles.customSafeguardEditor}>
                      <label className={styles.field} htmlFor={`custom-safeguard-${group.groupJid}`}>What should Pipelixr do in this group?
                        <textarea
                          id={`custom-safeguard-${group.groupJid}`}
                          className={styles.input}
                          value={draft.instructions}
                          maxLength={1_000}
                          rows={3}
                          autoFocus
                          placeholder="Example: Only answer delivery questions and stay silent on prices."
                          onChange={(event) => updateDraft(group.groupJid, { instructions: event.target.value })}
                        />
                        <span className={styles.fieldHelp}>Use at least {MIN_CUSTOM_INSTRUCTION_LENGTH} characters. Nothing changes until you save.</span>
                      </label>
                      <label className={styles.compactCheck}><input type="checkbox" checked={draft.allowPrivateHandoff} disabled={busy !== null} onChange={(event) => updateDraft(group.groupJid, { allowPrivateHandoff: event.target.checked })} />Allow private handoff after the person agrees</label>
                      <div className={styles.customSafeguardActions}>
                        <button type="button" className={buttonClass.secondary} disabled={busy !== null} onClick={() => setCustomDraft(null)}>Cancel</button>
                        <button type="button" className={buttonClass.primary} disabled={busy !== null || !canSaveCustom} onClick={() => void govern(group.groupJid, "custom", draft.allowPrivateHandoff, draft.instructions)}>{busy === group.groupJid ? "Saving…" : "Save safeguards"}</button>
                      </div>
                    </div>}
                    {!draft && group.governanceMode === "custom" && <div className={styles.savedSafeguards}>
                      <div><strong>Current custom safeguard</strong><p>{group.customInstructions}</p></div>
                      <button type="button" className={buttonClass.secondary} disabled={busy !== null} onClick={() => setCustomDraft({ groupJid: group.groupJid, instructions: group.customInstructions, allowPrivateHandoff: group.allowPrivateHandoff })}>Edit safeguards</button>
                    </div>}
                    {!draft && group.governanceMode !== "custom" && <label className={styles.compactCheck}><input type="checkbox" checked={group.allowPrivateHandoff} disabled={busy !== null} onChange={(event) => void govern(group.groupJid, group.governanceMode, event.target.checked, group.customInstructions)} />Allow private handoff after the person agrees</label>}
                  </div>}
                </div>
                <div className={styles.groupControls}>
                  <button type="button" className={group.isEnabled ? buttonClass.danger : buttonClass.primary} disabled={busy !== null || (!group.isEnabled && !ready)} onClick={() => void toggle(group.groupJid, !group.isEnabled)}>{busy === group.groupJid ? "Saving…" : group.isEnabled ? "Disable" : "Enable"}</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
