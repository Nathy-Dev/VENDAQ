"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AudioLines, Bot, Check, Mic, Pencil, ShieldCheck, Sparkles, Square } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { buttonClass } from "./dashboard-ui";
import { Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

type FeedbackScope = "voice" | "generate" | "save";
type ScopedFeedback = Exclude<Feedback, null> & { scope: FeedbackScope };

export default function BusinessAssistantSettings({ workspace, compact = false }: { workspace: Workspace; compact?: boolean }) {
  const profile = useQuery(api.businessProfile.get, { businessId: workspace.businessId });
  const qualificationPolicy = useQuery(api.leadQualification.policy, { businessId: workspace.businessId });
  return <div className={styles.stack}>
    <AiAssistantControl workspace={workspace} />
    {!profile || !qualificationPolicy
      ? <div className={styles.loading} role="status">Loading the reply playbook...</div>
      : <BusinessAssistantForm key={`${profile.updatedAt ?? 0}:${profile.customerAutoReplyEnabled}:${profile.groupAutoReplyEnabled}`} workspace={workspace} compact={compact} profile={profile} qualificationPolicy={qualificationPolicy} />}
  </div>;
}

function AiAssistantControl({ workspace }: { workspace: Workspace }) {
  const setEnabled = useMutation(api.businessProfile.setAssistantEnabled);
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function change(enabled: boolean) {
    setBusy(true);
    setFeedback(null);
    try {
      await setEnabled({ businessId: workspace.businessId, enabled });
      setFeedback({ text: enabled ? "AI Assistant turned on for new messages." : "AI Assistant turned off. Your inbox stays connected." });
    } catch (error) {
      const needsPlan = error instanceof Error && error.message.includes("BILLING_UPGRADE_REQUIRED");
      setFeedback({ text: needsPlan ? "Check your plan and usage limits before turning on AI Assistant." : "We couldn't change the AI setting. Please try again.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.card}>
    <div className={styles.sectionHeading}><div><h2>AI Assistant</h2><p>{workspace.aiEnabled ? "On · New messages can be processed by AI" : "Off · Human-only inbox"}</p></div><Bot size={18} aria-hidden="true" /></div>
    <label className={styles.checkLabel}>
      <input type="checkbox" role="switch" aria-label="AI Assistant" aria-describedby={descriptionId} checked={workspace.aiEnabled} disabled={busy} onChange={(event) => void change(event.target.checked)} />
      <span><strong>Process new WhatsApp messages</strong><p id={descriptionId}>When off, Pipelixr won’t analyze text or attachments, transcribe voice notes, or draft and send replies. Messages still arrive; you can view attachments and reply in WhatsApp. Messages received while off stay out of AI processing when you turn it back on.</p></span>
    </label>
    <Notice feedback={feedback} />
  </section>;
}

function BusinessAssistantForm({ workspace, compact, profile, qualificationPolicy }: { workspace: Workspace; compact: boolean; profile: NonNullable<ReturnType<typeof useQuery<typeof api.businessProfile.get>>>; qualificationPolicy: NonNullable<ReturnType<typeof useQuery<typeof api.leadQualification.policy>>> }) {
  const save = useMutation(api.businessProfile.save);
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(profile.systemPrompt);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [streamingPrompt, setStreamingPrompt] = useState(false);
  const [customerReplies, setCustomerReplies] = useState(profile.customerAutoReplyEnabled);
  const [groupReplies, setGroupReplies] = useState(profile.groupAutoReplyEnabled);
  const [qualificationEnabled, setQualificationEnabled] = useState(qualificationPolicy.enabled);
  const [qualificationCriteria, setQualificationCriteria] = useState(qualificationPolicy.criteria);
  const [qualificationFields, setQualificationFields] = useState(qualificationPolicy.requiredFields);
  const [busy, setBusy] = useState<"generate" | "transcribe" | "save" | null>(null);
  const [feedback, setFeedback] = useState<ScopedFeedback | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function convexToken(): Promise<string> {
    const response = await fetch("/api/auth/convex-token", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("AUTHENTICATION_REQUIRED");
    const result = await response.json() as { token?: string };
    if (!result.token) throw new Error("AUTHENTICATION_REQUIRED");
    return result.token;
  }

  function siteUrl(): string {
    const url = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.replace(/\/$/, "");
    if (!url) throw new Error("BUSINESS_AI_ENDPOINT_NOT_CONFIGURED");
    return url;
  }

  function formatRecordingTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    const remainder = (seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
  }

  async function transcribeRecording(blob: Blob) {
    if (blob.size > 10 * 1024 * 1024) {
      setFeedback({ scope: "voice", text: "That recording is too large. Please record a shorter description.", error: true });
      return;
    }
    setBusy("transcribe"); setFeedback(null);
    try {
      const token = await convexToken();
      const form = new FormData();
      form.append("businessId", workspace.businessId);
      form.append("recording", blob, "business-description.webm");
      const response = await fetch(`${siteUrl()}/api/business-ai/transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const result = await response.json().catch(() => ({})) as { transcript?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "TRANSCRIPTION_FAILED");
      const transcript = result.transcript?.trim();
      if (!transcript) throw new Error("EMPTY_TRANSCRIPT");
      setDescription((current) => [current.trim(), transcript].filter(Boolean).join("\n\n").slice(0, 4_000));
      setFeedback({ scope: "voice", text: "Voice description added. You can correct the transcript or add more details before generating." });
    } catch (error) {
      const code = error instanceof Error ? error.message : "TRANSCRIPTION_FAILED";
      const message = code === "BUSINESS_AI_RATE_LIMITED"
        ? "You've used the voice helper several times this hour. Please try again later."
        : code === "OPENAI_TRANSCRIPTION_RATE_LIMITED"
          ? "The voice service is busy right now. Please wait a minute and try again."
          : code === "OPENAI_TRANSCRIPTION_QUOTA_EXHAUSTED"
            ? "Voice transcription is temporarily unavailable. You can still type your business description."
            : code === "AUDIO_SIZE_NOT_SUPPORTED"
              ? "That recording could not be processed. Please make a shorter recording and try again."
              : "We couldn't transcribe that recording. Check your connection and try again.";
      setFeedback({ scope: "voice", text: message, error: true });
    } finally {
      setBusy(null);
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setFeedback({ scope: "voice", text: "Voice recording is not supported by this browser. You can still type your business description.", error: true });
      return;
    }
    setFeedback(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const supportedType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, supportedType ? { mimeType: supportedType, audioBitsPerSecond: 64_000 } : { audioBitsPerSecond: 64_000 });
      recorderRef.current = recorder;
      streamRef.current = stream;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => setFeedback({ scope: "voice", text: "The recording stopped unexpectedly. Please try again.", error: true });
      recorder.onstop = () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size >= 512) void transcribeRecording(blob);
        else setFeedback({ scope: "voice", text: "We couldn't hear enough audio. Please try recording again.", error: true });
      };
      recorder.start(1_000);
      setRecordingSeconds(0);
      setRecording(true);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((seconds) => {
          if (seconds >= 179 && recorderRef.current?.state === "recording") recorderRef.current.stop();
          return Math.min(180, seconds + 1);
        });
      }, 1_000);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setFeedback({ scope: "voice", text: "Microphone access was not available. Allow microphone access in your browser, then try again.", error: true });
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function generatePrompt() {
    const source = description.trim();
    if (source.length < 40) {
      setFeedback({ scope: "generate", text: "Add at least a few sentences about what you sell, how orders work, and what customers usually ask.", error: true });
      return;
    }
    const previousPrompt = systemPrompt;
    setBusy("generate"); setStreamingPrompt(true); setEditingPrompt(false); setFeedback(null); setSystemPrompt("");
    try {
      const token = await convexToken();
      const response = await fetch(`${siteUrl()}/api/business-ai/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: workspace.businessId, businessDescription: source }),
        signal: AbortSignal.timeout(45_000),
      });
      if (response.status === 429) throw new Error("BUSINESS_AI_RATE_LIMITED");
      if (!response.ok || !response.body) throw new Error("AI_GENERATION_FAILED");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let generated = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        generated += decoder.decode(chunk.value, { stream: true });
        setSystemPrompt(generated);
      }
      generated += decoder.decode();
      const complete = generated.replaceAll("\u0000", "").trim().slice(0, 8_000);
      if (complete.length < 120) throw new Error("AI_GENERATION_FAILED");
      setSystemPrompt(complete);
      setFeedback({ scope: "generate", text: "Your Pipelixr playbook is ready. Review it, use Edit if anything needs changing, then save." });
    } catch (error) {
      setSystemPrompt(previousPrompt);
      setFeedback({ scope: "generate", text: error instanceof Error && error.message === "BUSINESS_AI_RATE_LIMITED" ? "You've generated several prompts this hour. Please try again later. Your existing prompt has not been changed." : "We couldn't generate the prompt right now. Your existing prompt has not been changed.", error: true });
    } finally {
      setBusy(null); setStreamingPrompt(false);
    }
  }

  async function saveProfile() {
    if (systemPrompt.trim().length < 120) {
      setFeedback({ scope: "save", text: "The reply playbook needs more detail before Pipelixr can reply accurately.", error: true });
      return;
    }
    setBusy("save"); setFeedback(null);
    try {
      await save({ businessId: workspace.businessId, systemPrompt: systemPrompt.trim(), customerAutoReplyEnabled: customerReplies, groupAutoReplyEnabled: groupReplies, assistantSettingsVersion: 2, leadQualificationEnabled: qualificationEnabled, leadQualificationCriteria: qualificationCriteria.trim(), leadQualificationRequiredFields: qualificationFields });
      setEditingPrompt(false);
      setFeedback({ scope: "save", text: !workspace.aiEnabled ? "Settings saved. AI Assistant remains off." : customerReplies || groupReplies ? "Business knowledge and reply authorization saved." : "Business knowledge saved. Auto-replies remain off." });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const needsAutomationPlan = code.includes("BILLING_UPGRADE_REQUIRED") || code.includes("BILLING_READ_ONLY");
      setFeedback({
        scope: "save",
        text: needsAutomationPlan
          ? "Your business knowledge is ready, but automated replies need an active automation plan. Turn off reply authorization to save the knowledge now, or activate a plan."
          : "We couldn't save these assistant settings. Please try again.",
        error: true,
      });
    } finally { setBusy(null); }
  }

  return <div className={styles.stack}>
    <section className={styles.card}>
      <div className={styles.sectionHeading}><div><h2>Teach Pipelixr</h2><p>Prepare a business playbook and choose where Pipelixr may send replies when AI Assistant is on.</p></div><Bot size={18} aria-hidden="true" /></div>
      <div className={styles.infoBanner}><ShieldCheck size={17} aria-hidden="true" /><p>Only include business information you are comfortable using in customer conversations. Do not paste passwords, private keys, card details, or customer data.</p></div>
      <div className={styles.form}>
        <label className={styles.field}>Describe your business in your own words
          <textarea className={`${styles.input} ${styles.textarea}`} rows={compact ? 5 : 7} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What do you sell? Who do you serve? What are your prices or price rules? Where do you deliver? How do customers order and pay? What should Pipelixr never promise?" />
          <span className={styles.fieldHelp}>Type, record, or combine both. This source material is only used to create the reply playbook below.</span>
        </label>
        <div className={styles.voiceComposer} data-recording={recording}>
          <div className={styles.voiceComposerMain}>
            <span className={styles.voiceIcon} aria-hidden="true">{recording ? <AudioLines size={19} /> : <Mic size={19} />}</span>
            <div><strong>{recording ? "Listening to your business story" : busy === "transcribe" ? "Turning your voice into text" : "Prefer to explain it by voice?"}</strong><p>{recording ? `Recording ${formatRecordingTime(recordingSeconds)} of 03:00` : busy === "transcribe" ? "This usually takes a few seconds." : "Speak naturally in English, Nigerian Pidgin, or a mix. Pipelixr will add the transcript above."}</p></div>
          </div>
          {recording && <div className={styles.voiceWave} aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <span key={index} style={{ animationDelay: `${index * -70}ms` }} />)}</div>}
          <button type="button" className={recording ? buttonClass.danger : buttonClass.secondary} disabled={busy !== null} onClick={recording ? stopRecording : () => void startRecording()}>{recording ? <><Square size={13} fill="currentColor" />Stop recording</> : <><Mic size={14} />Record description</>}</button>
        </div>
        <Notice feedback={feedback?.scope === "voice" ? feedback : null} />
        <div className={styles.generatorRow}><button type="button" className={buttonClass.secondary} disabled={busy !== null || recording || description.trim().length < 40} onClick={() => void generatePrompt()}><Sparkles size={14} />{busy === "generate" ? "Creating your Pipelixr playbook..." : "Create my Pipelixr playbook"}</button><span>Uses everything in your description above.</span></div>
        <Notice feedback={feedback?.scope === "generate" ? feedback : null} />
        <div className={styles.promptField}>
          <div className={styles.promptHeader}><div><span>Reply playbook used for every response</span><small>{editingPrompt ? "Editing is on. Save when your changes are ready." : "Locked to prevent accidental changes."}</small></div><button type="button" className={buttonClass.ghost} disabled={streamingPrompt || busy === "save"} onClick={() => setEditingPrompt((value) => !value)}>{editingPrompt ? <><Check size={14} />Done editing</> : <><Pencil size={14} />Edit playbook</>}</button></div>
          {editingPrompt ? <textarea autoFocus className={`${styles.input} ${styles.textarea} ${styles.promptTextarea}`} rows={compact ? 12 : 18} minLength={120} maxLength={8000} required value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="Define the business, products, sales process, policies, tone, escalation rules, and what Pipelixr must never invent." /> : <div className={styles.promptViewer} data-streaming={streamingPrompt} data-empty={!systemPrompt}><pre>{systemPrompt || "Your Pipelixr reply playbook will appear here."}{streamingPrompt && <span className={styles.streamingCursor} aria-hidden="true" />}</pre></div>}
          <div className={styles.promptMeta}><span>{systemPrompt.trim().length.toLocaleString()} / 8,000 characters</span><span>{streamingPrompt ? "Generating live" : editingPrompt ? "Editable" : "Protected"}</span></div>
        </div>
        <fieldset className={styles.fieldset}>
          <legend>Auto-reply</legend>
          <p className={styles.helper}>These settings only control automatic sending. Use AI Assistant above to stop analysis and drafts as well.</p>
          <label className={styles.checkLabel}><input type="checkbox" role="switch" checked={customerReplies} onChange={(event) => setCustomerReplies(event.target.checked)} /><span><strong>Auto-reply in one-to-one chats</strong><p>Generate and send replies to eligible customers when AI Assistant is on.</p></span></label>
          <label className={styles.checkLabel}><input type="checkbox" role="switch" checked={groupReplies} onChange={(event) => setGroupReplies(event.target.checked)} /><span><strong>Allow replies in individually enabled groups</strong><p>This is only global permission. Every group or community stays off until you enable it separately.</p></span></label>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend>Automatic lead qualification</legend>
          <label className={styles.checkLabel}><input type="checkbox" role="switch" checked={qualificationEnabled} onChange={(event) => setQualificationEnabled(event.target.checked)} /><span><strong>Automatically qualify one-to-one leads</strong><p>Pipelixr gathers only missing details during normal conversation and marks a lead qualified when your requirements are met.</p></span></label>
          {qualificationEnabled && <>
            <label className={styles.field}>What makes someone a good lead for your business?<textarea className={`${styles.input} ${styles.textarea}`} rows={5} minLength={30} maxLength={2000} value={qualificationCriteria} onChange={(event) => setQualificationCriteria(event.target.value)} placeholder="Describe who is a good fit, where you serve, workable budgets, timing, and what ready to proceed means for your business." /><span className={styles.fieldHelp}>Use simple words. Pipelixr uses this together with your reply playbook and never tells customers an internal score.</span></label>
            <div className={styles.field}><span>Details Pipelixr should confirm</span><div className={styles.qualificationFields}>{qualificationPolicy.availableFields.map((entry) => <label className={styles.checkLabel} key={entry.field}><input type="checkbox" checked={qualificationFields.includes(entry.field)} onChange={(event) => setQualificationFields((current) => event.target.checked ? [...new Set([...current, entry.field])] : current.filter((field) => field !== entry.field))} /><span><strong>{entry.label}</strong><p>{entry.question}</p></span></label>)}</div><span className={styles.fieldHelp}>Pipelixr asks at most one missing qualification question in a reply and does not keep repeating the same question.</span></div>
          </>}
        </fieldset>
        <div className={styles.formFooter}><button type="button" className={buttonClass.primary} disabled={busy !== null || recording || systemPrompt.trim().length < 120} onClick={() => void saveProfile()}>{busy === "save" ? "Saving..." : "Save business knowledge & authorization"}</button></div>
        <Notice feedback={feedback?.scope === "save" ? feedback : null} />
      </div>
    </section>
  </div>;
}
