"use client";

import { useMutation, useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { workspaceScreen } from "@/lib/workspace-ui";
import DashboardShell from "./DashboardShell";
import WorkspaceOverview from "./WorkspaceOverview";
import WorkspaceInbox from "./WorkspaceInbox";
import SellerWorkspacePanels from "./SellerWorkspacePanels";
import WorkspaceSettings, { ProfilePanel } from "./WorkspaceSettings";
import { PageHeader } from "./dashboard-ui";
import WorkspaceOnboarding from "./WorkspaceOnboarding";
import BillingWorkspace from "./BillingWorkspace";
import styles from "./FoundationWorkspace.module.css";

export default function FoundationWorkspace() {
  const workspace = useQuery(api.foundation.workspace, {});
  const touchWorkspace = useMutation(api.productAnalytics.touchWorkspace);
  const pathname = usePathname();
  const screen = workspaceScreen(pathname);
  const isOnboarding = screen === "setup" || screen === "connect";
  const [onboardingOrigin, setOnboardingOrigin] = useState<string | null>(null);
  const businessId = workspace?.businessId;
  useEffect(() => { if (businessId) void touchWorkspace({ businessId }); }, [touchWorkspace, businessId]);
  if (onboardingOrigin !== null && onboardingOrigin !== pathname) setOnboardingOrigin(null);

  if (workspace === undefined || !workspace || isOnboarding || onboardingOrigin === pathname) {
    return (
      <main className={styles.setupScreen}>
        {workspace === undefined ? <div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true" />Loading your workspace…</div> :
          <WorkspaceOnboarding workspace={workspace} onCreatingChange={(creating) => setOnboardingOrigin(creating ? pathname : null)} />}
      </main>
    );
  }

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
      </div>
    </DashboardShell>
  );
}
