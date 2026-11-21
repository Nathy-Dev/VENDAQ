"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Bot, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { buttonClass } from "./dashboard-ui";
import { Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

export default function BusinessAssistantSettings({ workspace, compact = false }: { workspace: Workspace; compact?: boolean }) {
  const profile = useQuery(api.businessProfile.get, { businessId: workspace.businessId });
  const qualificationPolicy = useQuery(api.leadQualification.policy, { businessId: workspace.businessId });
  if (!profile || !qualificationPolicy) return <div className={styles.loading} role="status">Loading business AI settings...</div>;
  return <BusinessAssistantForm key={`${profile.updatedAt ?? 0}:${profile.customerAutoReplyEnabled}:${profile.groupAutoReplyEnabled}`} workspace={workspace} compact={compact} profile={profile} qualificationPolicy={qualificationPolicy} />;
}

function BusinessAssistantForm({ workspace, compact, profile, qualificationPolicy }: { workspace: Workspace; compact: boolean; profile: NonNullable<ReturnType<typeof useQuery<typeof api.businessProfile.get>>>; qualificationPolicy: NonNullable<ReturnType<typeof useQuery<typeof api.leadQualification.policy>>> }) {
  const save = useMutation(api.businessProfile.save);
  const generate = useAction(api.businessProfile.generateSystemPrompt);
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(profile.systemPrompt);
  const [customerReplies, setCustomerReplies] = useState(profile.customerAutoReplyEnabled);
  const [groupReplies, setGroupReplies] = useState(profile.groupAutoReplyEnabled);
  const [qualificationEnabled, setQualificationEnabled] = useState(qualificationPolicy.enabled);
  const [qualificationCriteria, setQualificationCriteria] = useState(qualificationPolicy.criteria);
  const [qualificationFields, setQualificationFields] = useState(qualificationPolicy.requiredFields);
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function generatePrompt() {
    const source = description.trim();
    if (source.length < 40) {
      setFeedback({ text: "Add at least a few sentences about what you sell, how orders work, and what customers usually ask.", error: true });
      return;
    }
    setBusy("generate"); setFeedback(null);
    try {
      const result = await generate({ businessId: workspace.businessId, businessDescription: source });
      setSystemPrompt(result.systemPrompt);
      setFeedback({ text: "A comprehensive system prompt is ready. Review it, correct anything inaccurate, then save." });
    } catch {
      setFeedback({ text: "We couldn't generate the prompt right now. You can still write or paste one below.", error: true });
    } finally { setBusy(null); }
  }

  async function saveProfile() {
    if (systemPrompt.trim().length < 120) {
      setFeedback({ text: "The system prompt needs more detail before Pipelixr can reply accurately.", error: true });
      return;
    }
    setBusy("save"); setFeedback(null);
    try {
      await save({ businessId: workspace.businessId, systemPrompt: systemPrompt.trim(), customerAutoReplyEnabled: customerReplies, groupAutoReplyEnabled: groupReplies, leadQualificationEnabled: qualificationEnabled, leadQualificationCriteria: qualificationCriteria.trim(), leadQualificationRequiredFields: qualificationFields });
      setFeedback({ text: customerReplies || groupReplies ? "Business knowledge and reply authorization saved." : "Business knowledge saved. Automated replies remain off." });
    } catch {
      setFeedback({ text: "We couldn't save these assistant settings. Please try again.", error: true });
    } finally { setBusy(null); }
  }

  return <div className={styles.stack}>
    <section className={styles.card}>
      <div className={styles.sectionHeading}><div><h2>{compact ? "Teach Pipelixr about your business" : "Business AI brief"}</h2><p>Pipelixr will not reply unless this system prompt is complete and you explicitly authorize it.</p></div><Bot size={18} aria-hidden="true" /></div>
      <div className={styles.infoBanner}><ShieldCheck size={17} aria-hidden="true" /><p>Only include business information you are comfortable using in customer conversations. Do not paste passwords, private keys, card details, or customer data.</p></div>
      <div className={styles.form}>
        <label className={styles.field}>Describe your business in your own words
          <textarea className={`${styles.input} ${styles.textarea}`} rows={compact ? 5 : 7} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What do you sell? Who do you serve? What are your prices or price rules? Where do you deliver? How do customers order and pay? What should Pipelixr never promise?" />
          <span className={styles.fieldHelp}>This is source material for the generator. It is not saved unless you use the generated result below.</span>
        </label>
        <div><button type="button" className={buttonClass.secondary} disabled={busy !== null || description.trim().length < 40} onClick={() => void generatePrompt()}><Sparkles size={14} />{busy === "generate" ? "Generating…" : "Generate comprehensive system prompt"}</button></div>
        <label className={styles.field}>System prompt used for every reply
          <textarea className={`${styles.input} ${styles.textarea} ${styles.promptTextarea}`} rows={compact ? 12 : 18} minLength={120} maxLength={8000} required value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="Define the business, products, sales process, policies, tone, escalation rules, and what the assistant must never invent." />
          <span className={styles.fieldHelp}>{systemPrompt.trim().length.toLocaleString()} / 8,000 characters. Review generated content for accuracy before enabling replies.</span>
        </label>
        <fieldset className={styles.fieldset}>
          <legend>Authorize Pipelixr</legend>
          <label className={styles.checkLabel}><input type="checkbox" role="switch" checked={customerReplies} onChange={(event) => setCustomerReplies(event.target.checked)} /><span><strong>Reply to customers in one-to-one chats</strong><p>Generate and send a concise reply after an eligible inbound text message.</p></span></label>
          <label className={styles.checkLabel}><input type="checkbox" role="switch" checked={groupReplies} onChange={(event) => setGroupReplies(event.target.checked)} /><span><strong>Allow replies in individually enabled groups</strong><p>This is only global permission. Every group or community stays off until you enable it separately.</p></span></label>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend>Automatic lead qualification</legend>
          <label className={styles.checkLabel}><input type="checkbox" role="switch" checked={qualificationEnabled} onChange={(event) => setQualificationEnabled(event.target.checked)} /><span><strong>Automatically qualify one-to-one leads</strong><p>Pipelixr gathers only missing details during normal conversation and marks a lead qualified when your requirements are met.</p></span></label>
          {qualificationEnabled && <>
            <label className={styles.field}>What makes someone a good lead for your business?<textarea className={`${styles.input} ${styles.textarea}`} rows={5} minLength={30} maxLength={2000} value={qualificationCriteria} onChange={(event) => setQualificationCriteria(event.target.value)} placeholder="Describe who is a good fit, where you serve, workable budgets, timing, and what ready to proceed means for your business." /><span className={styles.fieldHelp}>Use simple words. Pipelixr uses this together with your business system prompt and never tells customers an internal score.</span></label>
            <div className={styles.field}><span>Details Pipelixr should confirm</span><div className={styles.qualificationFields}>{qualificationPolicy.availableFields.map((entry) => <label className={styles.checkLabel} key={entry.field}><input type="checkbox" checked={qualificationFields.includes(entry.field)} onChange={(event) => setQualificationFields((current) => event.target.checked ? [...new Set([...current, entry.field])] : current.filter((field) => field !== entry.field))} /><span><strong>{entry.label}</strong><p>{entry.question}</p></span></label>)}</div><span className={styles.fieldHelp}>Pipelixr asks at most one missing qualification question in a reply and does not keep repeating the same question.</span></div>
          </>}
        </fieldset>
        <Notice feedback={feedback} />
        <div className={styles.formFooter}><button type="button" className={buttonClass.primary} disabled={busy !== null || systemPrompt.trim().length < 120} onClick={() => void saveProfile()}>{busy === "save" ? "Saving…" : "Save business knowledge & authorization"}</button></div>
      </div>
    </section>
  </div>;
}
