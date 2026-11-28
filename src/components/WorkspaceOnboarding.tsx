"use client";

import { useMutation } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Link2, ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { launchOnboardingStage } from "@/lib/workspace-ui";
import type { Workspace } from "@/types/workspace";
import Brand from "./Brand";
import BusinessAssistantSettings from "./BusinessAssistantSettings";
import ConnectionPanel from "./WorkspaceConnection";
import WorkspaceGroups from "./WorkspaceGroups";
import { buttonClass } from "./dashboard-ui";
import { Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

const steps = [
  { id: "business", label: "Your business", title: "A space for your business.", description: "Start with your business name. Next you will connect WhatsApp and teach Pipelixr how to represent you." },
  { id: "connection", label: "Connect WhatsApp", title: "Connect WhatsApp", description: "Connect the WhatsApp number you use for this business. You’ll choose reply permissions separately." },
  { id: "business_ai", label: "Teach Pipelixr", title: "Teach Pipelixr", description: "Tell Pipelixr about your business and review the playbook it will use. You decide whether it can reply automatically." },
  { id: "groups", label: "Groups", title: "Choose your groups", description: "Choose which groups Pipelixr can help with, or leave them all off. You can change this later in Settings." },
] as const;

export default function WorkspaceOnboarding({ workspace, onCreatingChange }: { workspace: Workspace | null; onCreatingChange: (creating: boolean) => void }) {
  const stage = workspace ? launchOnboardingStage(workspace) : "business";
  const stepIndex = steps.findIndex((step) => step.id === stage);
  const metaFinish = stage === "groups" && workspace?.connectionProvider === "meta";
  const { title, description } = metaFinish
    ? { title: "You’re ready to go", description: "Your WhatsApp Business number is connected through Meta. You can review your conversations in the dashboard." }
    : steps[stepIndex];
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStage = useRef(stage);
  const exitRequested = useRef(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest("section")?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [stage]);

  function leaveSetup() {
    exitRequested.current = true;
    onCreatingChange(false);
  }

  function continueSetup() {
    if (!exitRequested.current && window.location.pathname === pathname && pathname !== "/onboarding/connect") {
      router.replace("/onboarding/connect", { scroll: false });
    }
  }

  return (
    <section className={`${styles.card} ${styles.setupCard}`} aria-labelledby="onboarding-title">
      <Brand />
      <h1 id="onboarding-title" ref={heading} tabIndex={-1}>{title}</h1>
      <p>{description}</p>
      <ol className={styles.steps} aria-label="Onboarding progress">
        {steps.map((step, index) => (
          <li key={step.id} aria-current={index === stepIndex ? "step" : undefined} data-complete={index < stepIndex || undefined}>
            <b aria-hidden="true">{index < stepIndex ? <Check size={12} /> : index + 1}</b>
            <span className="sr-only">{index < stepIndex ? "Completed: " : `Step ${index + 1}: `}</span>{step.id === "groups" && workspace?.connectionProvider === "meta" ? "Finish setup" : step.label}
          </li>
        ))}
      </ol>
      {!workspace && <BusinessSetup onCreatingChange={onCreatingChange} onCreated={continueSetup} />}
      {workspace && stage === "connection" && <ConnectionPanel workspace={workspace} embedded />}
      {workspace && stage === "business_ai" && <BusinessAssistantSettings workspace={workspace} compact />}
      {workspace && stage !== "groups" && <div className={styles.setupFooter}><Link href="/dashboard" replace onNavigate={leaveSetup} className={buttonClass.secondary}>Skip for now</Link><p className={styles.helper}>You can finish setting up later.</p></div>}
      {workspace && stage === "groups" && <>
        {workspace.connectionProvider === "meta" ? <p className={styles.helper}>This Meta connection syncs individual chats only. You can continue using groups in your WhatsApp Business app.</p> : <WorkspaceGroups workspace={workspace} embedded />}
        <div className={styles.setupFooter}>
          <Link href="/dashboard" replace onNavigate={leaveSetup} className={buttonClass.primary}>Finish setup<ArrowRight size={14} aria-hidden="true" /></Link>
          <p className={styles.helper}>{workspace.connectionProvider === "meta" ? "Automatic replies stay off until you explicitly authorize them." : "Pipelixr only replies after you explicitly authorize customer replies or enable individual groups."}</p>
        </div>
      </>}
    </section>
  );
}

function BusinessSetup({ onCreatingChange, onCreated }: { onCreatingChange: (creating: boolean) => void; onCreated: () => void }) {
  const createBusiness = useMutation(api.foundation.createBusiness);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  return <>
    <form className={styles.form} onSubmit={async (event) => {
      event.preventDefault();
      if (busy || name.trim().length < 2) return;
      setBusy(true);
      setFeedback(null);
      onCreatingChange(true);
      try {
        await createBusiness({ name: name.trim() });
        onCreated();
      } catch {
        onCreatingChange(false);
        setFeedback({ text: "We couldn't create your workspace. Check the name and try again. If you already have an account, ask your operator to verify its migration.", error: true });
        setBusy(false);
      }
    }}>
      <label className={styles.field} htmlFor="business-name">Business name<input id="business-name" name="organization" autoComplete="organization" className={styles.input} placeholder="e.g. Ada's Studio" required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
      <Notice feedback={feedback} />
      <button type="submit" className={buttonClass.primary} disabled={busy || name.trim().length < 2}>{busy ? "Creating workspace…" : "Continue"}{!busy && <ArrowRight size={14} aria-hidden="true" />}</button>
    </form>
    <div className={`${styles.infoBanner} ${styles.setupPrivacy}`}><ShieldCheck size={17} aria-hidden="true" /><span>Your workspace is private to your account. Existing businesses are never linked automatically by email.</span></div>
    <p className={`${styles.finePrint} ${styles.setupConsent}`}><Link2 size={12} aria-hidden="true" />WhatsApp pairing and automated replies each require separate explicit consent.</p>
  </>;
}
