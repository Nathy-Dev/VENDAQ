"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Clock3 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { FollowUpSettingsData, Workspace } from "@/types/workspace";
import { buttonClass } from "./dashboard-ui";
import { LoadingRows, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

export default function FollowUpRules({ workspace }: { workspace: Workspace }) {
  const settings = useQuery(api.followUps.settings, { businessId: workspace.businessId });
  if (settings === undefined) return <LoadingRows label="Loading follow-up rules" />;
  return <RulesForm workspace={workspace} settings={settings} />;
}

function RulesForm({ workspace, settings }: { workspace: Workspace; settings: FollowUpSettingsData }) {
  const update = useMutation(api.followUps.updateSettings);
  const [form, setForm] = useState(settings);
  const [cooldown, setCooldown] = useState(String(settings.cooldownMinutes));
  const [dailyCap, setDailyCap] = useState(String(settings.dailyCap));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  function field<Key extends keyof FollowUpSettingsData>(key: Key, value: FollowUpSettingsData[Key]) { setForm((current) => ({ ...current, [key]: value })); }

  return <section className={styles.card}>
    <div className={styles.sectionHeading}><div><h2>Follow-up rules</h2><p>Thoughtful drafts, at the right time. You still send every message yourself.</p></div><Clock3 size={18} aria-hidden="true" /></div>
    <form className={styles.form} onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      const cooldownMinutes = Number(cooldown);
      const cap = Number(dailyCap);
      if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 15 || cooldownMinutes > 43200 || !Number.isInteger(cap) || cap < 1 || cap > 100) { setFeedback({ text: "Choose a cooldown from 15 to 43,200 minutes and a daily cap from 1 to 100.", error: true }); return; }
      setBusy(true); setFeedback(null);
      try {
        await update({ businessId: workspace.businessId, template: form.template.trim(), cooldownMinutes, dailyCap: cap, workHoursEnabled: form.workHoursEnabled, workHoursStart: form.workHoursStart, workHoursEnd: form.workHoursEnd, quietHoursEnabled: form.quietHoursEnabled, quietHoursStart: form.quietHoursStart, quietHoursEnd: form.quietHoursEnd, aiEnabled: form.aiEnabled });
        setFeedback({ text: "Follow-up rules saved. No messages have been sent." });
      } catch { setFeedback({ text: "We couldn't save these rules. Keep the template conversational, avoid payment or promotional claims, and check your time settings.", error: true }); }
      finally { setBusy(false); }
    }}>
      <label className={styles.field}>Default draft<textarea className={`${styles.input} ${styles.textarea}`} required minLength={10} maxLength={1000} value={form.template} disabled={busy} onChange={(event) => field("template", event.target.value)} /><span className={styles.fieldHelp}>Use {"{name}"} for the customer’s name. Keep it short and relevant; templates are checked before saving.</span></label>
      <div className={styles.formGrid}>
        <label className={styles.field}>Cooldown in minutes<input className={styles.input} type="number" min="15" max="43200" step="1" required disabled={busy} value={cooldown} onChange={(event) => setCooldown(event.target.value)} /><span className={styles.fieldHelp}>Minimum time between suggestions for a customer.</span></label>
        <label className={styles.field}>Daily suggestion cap<input className={styles.input} type="number" min="1" max="100" step="1" required disabled={busy} value={dailyCap} onChange={(event) => setDailyCap(event.target.value)} /><span className={styles.fieldHelp}>Limit the number of suggestions, not messages sent.</span></label>
      </div>
      <fieldset className={styles.fieldset} disabled={busy}>
        <legend>Availability · {workspace.timezone.replaceAll("_", " ")}</legend>
        <label className={styles.checkLabel}><input type="checkbox" checked={form.workHoursEnabled} onChange={(event) => field("workHoursEnabled", event.target.checked)} /><span>Show suggestions during working hours</span></label>
        <div className={styles.formGrid}>
          <label className={styles.field}>Work starts<input className={styles.input} type="time" required disabled={!form.workHoursEnabled} value={timeValue(form.workHoursStart)} onChange={(event) => { if (event.target.value) field("workHoursStart", minuteValue(event.target.value)); }} /></label>
          <label className={styles.field}>Work ends<input className={styles.input} type="time" required disabled={!form.workHoursEnabled} value={timeValue(form.workHoursEnd)} onChange={(event) => { if (event.target.value) field("workHoursEnd", minuteValue(event.target.value)); }} /></label>
        </div>
        <label className={styles.checkLabel}><input type="checkbox" checked={form.quietHoursEnabled} onChange={(event) => field("quietHoursEnabled", event.target.checked)} /><span>Pause suggestions during quiet hours</span></label>
        <div className={styles.formGrid}>
          <label className={styles.field}>Quiet hours start<input className={styles.input} type="time" required disabled={!form.quietHoursEnabled} value={timeValue(form.quietHoursStart)} onChange={(event) => { if (event.target.value) field("quietHoursStart", minuteValue(event.target.value)); }} /></label>
          <label className={styles.field}>Quiet hours end<input className={styles.input} type="time" required disabled={!form.quietHoursEnabled} value={timeValue(form.quietHoursEnd)} onChange={(event) => { if (event.target.value) field("quietHoursEnd", minuteValue(event.target.value)); }} /></label>
        </div>
        <p className={styles.fieldHelp}>Overnight windows are supported. Equal start and end times remove that window’s restriction.</p>
      </fieldset>
      <label className={styles.checkLabel}><input type="checkbox" checked={form.aiEnabled} disabled={busy || (!settings.aiAvailable && !form.aiEnabled)} onChange={(event) => field("aiEnabled", event.target.checked)} /><span><strong>Optional assisted drafts</strong><p>{settings.aiAvailable ? "Checked suggestions can use assisted wording, with a safe template fallback. Manual review and sending are still required." : "Not available in this deployment. Your default template is used instead."}</p></span></label>
      <Notice feedback={feedback} />
      <div className={styles.formFooter}><button type="submit" className={buttonClass.primary} disabled={busy}>{busy ? "Saving…" : "Save rules"}</button><p>Changes apply to new suggestions.</p></div>
    </form>
  </section>;
}

function timeValue(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function minuteValue(value: string): number { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; }
