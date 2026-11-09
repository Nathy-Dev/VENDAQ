"use client";

import { useMutation, useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Link2, ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { workspaceScreen } from "@/lib/workspace-ui";
import Brand from "./Brand";
import DashboardShell from "./DashboardShell";
import WorkspaceOverview from "./WorkspaceOverview";
import WorkspaceInbox from "./WorkspaceInbox";
import SellerWorkspacePanels from "./SellerWorkspacePanels";
import WorkspaceSettings, { ConnectionPanel, ViewersPanel, ProfilePanel } from "./WorkspaceSettings";
import { buttonClass, PageHeader } from "./dashboard-ui";
import { Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

export default function FoundationWorkspace() {
  const workspace = useQuery(api.foundation.workspace, {});
  const pathname = usePathname();
  const screen = workspaceScreen(pathname);

  if (workspace === undefined) return <DashboardShell><div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true" />Loading your workspace…</div></DashboardShell>;
  if (!workspace) return <DashboardShell><BusinessSetup /></DashboardShell>;

  return (
    <DashboardShell>
      <div className={styles.page} key={workspace.businessId}>
        {screen === "overview" && <WorkspaceOverview workspace={workspace} />}
        {screen === "inbox" && <WorkspaceInbox workspace={workspace} />}
        {screen === "actions" && <SellerWorkspacePanels workspace={workspace} />}
        {screen === "viewers" && <><PageHeader title="Status viewers" description="Private observation records, separate from your conversations and leads." /><ViewersPanel workspace={workspace} /></>}
        {screen === "settings" && <WorkspaceSettings workspace={workspace} />}
        {screen === "profile" && <ProfilePanel workspace={workspace} />}
        {(screen === "setup" || screen === "connect") && (
          <div className={styles.stack}>
            <PageHeader title="Connect your WhatsApp" description="One last step. Review the connection details before pairing your number." />
            <div className={styles.steps}><span><b><Check size={12} /></b>Business created</span><span className={styles.current}><b>2</b>Connect WhatsApp</span></div>
            <ConnectionPanel workspace={workspace} />
            <div><Link href="/dashboard" className={buttonClass.secondary}>Go to workspace<ArrowRight size={14} /></Link><p className={styles.helper}>You can connect later from Settings. No messages are sent by Pipelixr.</p></div>
          </div>
        )}
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
      <p>Keep conversations, follow-ups, and orders together. Let’s start with your business name.</p>
      <div className={styles.steps}><span className={styles.current}><b>1</b>Your business</span><span><b>2</b>Connect WhatsApp</span></div>
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
      <p className={styles.finePrint} style={{ marginTop: 16 }}><Link2 size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />WhatsApp pairing is optional and requires your explicit consent.</p>
    </section>
  );
}
