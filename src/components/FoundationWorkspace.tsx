"use client";

import { useMutation, useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Link2, ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { launchOnboardingStage, workspaceScreen } from "@/lib/workspace-ui";
import Brand from "./Brand";
import DashboardShell from "./DashboardShell";
import WorkspaceOverview from "./WorkspaceOverview";
import WorkspaceInbox from "./WorkspaceInbox";
import SellerWorkspacePanels from "./SellerWorkspacePanels";
import WorkspaceSettings, { ConnectionPanel, ProfilePanel } from "./WorkspaceSettings";
import { buttonClass, PageHeader } from "./dashboard-ui";
import { Notice, type Feedback } from "./WorkspaceFeedback";
import BusinessAssistantSettings from "./BusinessAssistantSettings";
import WorkspaceGroups from "./WorkspaceGroups";
import BillingWorkspace from "./BillingWorkspace";
import styles from "./FoundationWorkspace.module.css";

export default function FoundationWorkspace() {
  const workspace = useQuery(api.foundation.workspace, {});
  const pathname = usePathname();
  const screen = workspaceScreen(pathname);

  if (workspace === undefined) return <DashboardShell><div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true" />Loading your workspace…</div></DashboardShell>;
  if (!workspace) return <DashboardShell><BusinessSetup /></DashboardShell>;

  return (
    <DashboardShell>
      <div className={`${styles.page} ${screen === "settings" ? styles.settingsPage : ""}`} key={workspace.businessId}>
        {screen === "overview" && <WorkspaceOverview workspace={workspace} />}
        {screen === "inbox" && <WorkspaceInbox workspace={workspace} />}
        {screen === "actions" && <SellerWorkspacePanels workspace={workspace} />}
        {screen === "viewers" && <><PageHeader title="Coming in a later phase" description="Status-to-Cash is preserved in the codebase but blocked for the first launch." /><section className={styles.card}><h2>Status-to-Cash is not part of Launch 1</h2><p className={styles.helper}>This route cannot collect viewers, create leads, or trigger outreach. It will be reintroduced behind a deliberate rollout later.</p></section></>}
        {screen === "settings" && <WorkspaceSettings workspace={workspace} />}
        {screen === "profile" && <ProfilePanel workspace={workspace} />}
        {screen === "billing" && <BillingWorkspace />}
        {(screen === "setup" || screen === "connect") && (() => {
          const stage = launchOnboardingStage(workspace);
          return (
          <div className={styles.stack}>
            <PageHeader title="Launch your WhatsApp assistant" description="Connect WhatsApp, teach Pipelixr about your business, then choose where it may reply." />
            <div className={styles.steps}>
              <span><b><Check size={12} /></b>Business created</span>
              <span className={stage === "connection" ? styles.current : undefined}><b>{stage === "connection" ? "2" : <Check size={12} />}</b>Connect WhatsApp</span>
              {stage !== "connection" && <span className={stage === "business_ai" ? styles.current : undefined}><b>{stage === "business_ai" ? "3" : <Check size={12} />}</b>Business AI</span>}
              {stage === "groups" && <span className={styles.current}><b>4</b>Groups</span>}
            </div>
            {stage === "connection" && <ConnectionPanel workspace={workspace} />}
            {stage === "business_ai" && <BusinessAssistantSettings workspace={workspace} compact />}
            {stage === "groups" && <><WorkspaceGroups workspace={workspace} /><div><Link href="/dashboard" className={buttonClass.secondary}>Go to workspace<ArrowRight size={14} /></Link><p className={styles.helper}>Pipelixr only replies after you explicitly authorize customer replies or enable individual groups.</p></div></>}
          </div>
          );
        })()}
      </div>
    </DashboardShell>
  );
}

function BusinessSetup() {
  const createBusiness = useMutation(api.foundation.createBusiness);
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  return (
    <section className={`${styles.card} ${styles.setupCard}`}>
      <Brand />
      <h1>A space for your business.</h1>
      <p>Start with your business name. Next you will connect WhatsApp and teach Pipelixr how to represent you.</p>
      <div className={styles.steps}><span className={styles.current}><b>1</b>Your business</span><span><b>2</b>Connect WhatsApp</span><span><b>3</b>Business AI</span></div>
      <form className={styles.form} onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setFeedback(null);
        try { await createBusiness({ name: name.trim() }); router.replace("/onboarding/connect"); }
        catch { setFeedback({ text: "We couldn't create your workspace. Check the name and try again. If you already have an account, ask your operator to verify its migration.", error: true }); }
        finally { setBusy(false); }
      }}>
        <label className={styles.field} htmlFor="business-name">Business name<input id="business-name" name="organization" autoComplete="organization" className={styles.input} placeholder="e.g. Ada's Studio" required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
        <Notice feedback={feedback} />
        <button className={buttonClass.primary} disabled={busy || name.trim().length < 2}>{busy ? "Creating workspace…" : "Continue"}{!busy && <ArrowRight size={14} />}</button>
      </form>
      <div className={styles.infoBanner} style={{ marginTop: 24 }}><ShieldCheck size={17} /><span>Your workspace is private to your account. Existing businesses are never linked automatically by email.</span></div>
      <p className={styles.finePrint} style={{ marginTop: 16 }}><Link2 size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />WhatsApp pairing and automated replies each require separate explicit consent.</p>
    </section>
  );
}
