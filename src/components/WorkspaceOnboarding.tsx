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
  { id: "connection", label: "Connect WhatsApp", title: "Connect WhatsApp", description: "Pair the WhatsApp number you use for this business. You’ll choose reply permissions separately." },
  { id: "business_ai", label: "Teach Pipelixr", title: "Teach Pipelixr", description: "Tell Pipelixr about your business and review the playbook it will use. You decide whether it can reply automatically." },
  { id: "groups", label: "Groups", title: "Choose your groups", description: "Choose which groups Pipelixr can help with, or leave them all off. You can change this later in Settings." },
] as const;

export default function WorkspaceOnboarding({ workspace, onCreatingChange }: { workspace: Workspace | null; onCreatingChange: (creating: boolean) => void }) {
  const stage = workspace ? launchOnboardingStage(workspace) : "business";
  const stepIndex = steps.findIndex((step) => step.id === stage);
  const { title, description } = steps[stepIndex];
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStage = useRef(stage);

  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest("section")?.scrollIntoView({ block: "start" });
  }, [stage]);

  return (
    <section className={`${styles.card} ${styles.setupCard}`} aria-labelledby="onboarding-title">
      <Brand />
      <h1 id="onboarding-title" ref={heading} tabIndex={-1}>{title}</h1>
      <p>{description}</p>
      <ol className={styles.steps} aria-label="Onboarding progress">
        {steps.map((step, index) => (
          <li key={step.id} aria-current={index === stepIndex ? "step" : undefined} data-complete={index < stepIndex || undefined}>
            <b aria-hidden="true">{index < stepIndex ? <Check size={12} /> : index + 1}</b>
            <span className="sr-only">{index < stepIndex ? "Completed: " : `Step ${index + 1}: `}</span>{step.label}
          </li>
        ))}
      </ol>
      {!workspace && <BusinessSetup onCreatingChange={onCreatingChange} />}
      {workspace && stage === "connection" && <ConnectionPanel workspace={workspace} embedded />}
      {workspace && stage === "business_ai" && <>
        <BusinessAssistantSettings workspace={workspace} compact />
        {!workspace.aiEnabled && <div className={styles.setupFooter}><Link href="/pipeline" className={buttonClass.secondary}>Go to inbox without AI<ArrowRight size={14} aria-hidden="true" /></Link></div>}
      </>}
      {workspace && stage === "groups" && <>
        <WorkspaceGroups workspace={workspace} embedded />
        <div className={styles.setupFooter}>
          <Link href="/dashboard" replace className={buttonClass.primary}>Finish setup<ArrowRight size={14} aria-hidden="true" /></Link>
          <p className={styles.helper}>Pipelixr only replies after you explicitly authorize customer replies or enable individual groups.</p>
        </div>
      </>}
    </section>
  );
}

function BusinessSetup({ onCreatingChange }: { onCreatingChange: (creating: boolean) => void }) {
  const createBusiness = useMutation(api.foundation.createBusiness);
  const pathname = usePathname();
  const router = useRouter();
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
        if (window.location.pathname === pathname && pathname !== "/onboarding/connect") router.replace("/onboarding/connect", { scroll: false });
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
