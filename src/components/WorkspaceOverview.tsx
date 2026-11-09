"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { useSession } from "next-auth/react";
import { ArrowRight, CheckCheck, ChevronRight, Clock3, ListTodo, MessageCircle, Settings, ShoppingBag, UsersRound } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { formatDate, formatMoney, initials } from "@/lib/workspace-ui";
import type { Workspace } from "@/types/workspace";
import { buttonClass, EmptyState, PageHeader, Panel, Pill, Stat, StatGrid } from "./dashboard-ui";
import { LoadingRows } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

export default function WorkspaceOverview({ workspace }: { workspace: Workspace }) {
  const { data: session } = useSession();
  const metrics = useQuery(api.measurement.dashboard, { businessId: workspace.businessId });
  const actions = useQuery(api.sellerActions.actionQueue, { businessId: workspace.businessId });
  const contacts = useQuery(api.foundation.customers, { businessId: workspace.businessId });
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const connected = workspace.state === "connected";

  return (
    <>
      <PageHeader eyebrow={workspace.name} title={firstName ? `Hey, ${firstName}.` : "Your day, at a glance."} description="A little less catching up. A little more moving forward."
        actions={<Link href="/pipeline" className={buttonClass.secondary}><MessageCircle size={15} />Open inbox</Link>} />
      <StatGrid>
        <Stat label="Leads captured" value={metrics?.leadsCaptured ?? "—"} hint="Customer-initiated conversations" icon={UsersRound} />
        <Stat label="Actions to review" value={actions?.length ?? "—"} hint="Ready for your attention" icon={ListTodo} />
        <Stat label="Recorded orders" value={metrics?.orders ?? "—"} hint="Entered by you" icon={ShoppingBag} />
        <Stat label="Claimed revenue" value={metrics ? formatMoney(metrics.claimedRecoveredRevenue) : "—"} hint="Seller-recorded, not independently verified" />
      </StatGrid>
      <div className={styles.overviewGrid}>
        <div className={styles.stack}>
          {!connected && <div className={styles.infoBanner}><MessageCircle size={18} /><div><strong>Your inbox is ready when you are.</strong><br />Connect WhatsApp to start capturing new conversations. <Link href="/onboarding/connect" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Review connection</Link></div></div>}
          <Panel title="Your next steps" description="Payment reminders first, then buying signals and quiet inquiries." flush action={<Link href="/revenue" className={buttonClass.ghost}>View all<ArrowRight size={13} /></Link>}>
            {actions === undefined ? <div style={{ padding: 20 }}><LoadingRows label="Loading your actions" /></div> : actions.length === 0 ?
              <EmptyState icon={CheckCheck} title="You're all caught up" description="When a conversation needs attention, your next step appears here." action={<Link href="/pipeline" className={buttonClass.secondary}>Browse your inbox</Link>} /> :
              <ul className={styles.focusList}>{actions.slice(0, 5).map((action) => <li key={action.taskId}><Link href="/revenue" className={styles.focusRow}>
                <span className={styles.avatar}>{initials(action.customerName)}</span><div className={styles.focusText}><strong>{action.customerName}</strong><p>{action.reasonText}</p></div>
                <div className={styles.focusTrailing}><Pill>{action.reason === "awaiting_payment" ? "Payment" : action.reason === "buying_signal" ? "Buying signal" : "Follow-up"}</Pill><ChevronRight size={15} /></div>
              </Link></li>)}</ul>}
          </Panel>
          <Panel title="Recent conversations" description="Your latest customer messages, all in one place." flush action={<Link href="/pipeline" className={buttonClass.ghost}>See inbox<ArrowRight size={13} /></Link>}>
            {contacts === undefined ? <div className={styles.loading} role="status">Loading conversations…</div> : contacts.length === 0 ?
              <EmptyState icon={MessageCircle} title="A fresh start" description="New direct messages appear here after you connect WhatsApp and accept the data-processing terms." /> :
              <ul className={styles.focusList}>{contacts.slice(0, 4).map((contact) => <li key={contact.customerId}><Link href={`/pipeline?contact=${encodeURIComponent(contact.customerId)}`} className={styles.focusRow}>
                <span className={styles.avatar}>{initials(contact.name)}</span><div className={styles.focusText}><strong>{contact.name}</strong><p>View captured conversation</p></div><div className={styles.focusTrailing}><time className={styles.finePrint}>{formatDate(contact.lastActivityAt, workspace.timezone)}</time><ChevronRight size={15} /></div>
              </Link></li>)}</ul>}
          </Panel>
          {metrics?.mayBeTruncated && <p className={styles.finePrint} role="status">This summary reached the {metrics.recordLimit}-record review limit and may be incomplete.</p>}
        </div>
        <aside className={styles.summaryRail} aria-label="Business summary">
          <div className={styles.card}>
            <div className={styles.businessHeader}><span className={styles.avatar}>{initials(workspace.name)}</span><div><strong>{workspace.name}</strong><p>Your business workspace</p></div></div>
            <div className={styles.statusLine}><span>WhatsApp</span><Pill dot tone={connected ? "positive" : "neutral"}>{connected ? "Connected" : "Not connected"}</Pill></div>
            <div className={styles.quickLinks}><Link className={styles.quickLink} href="/settings"><Settings size={16} />Workspace settings<ChevronRight size={14} /></Link><Link className={styles.quickLink} href="/revenue"><ShoppingBag size={16} />Orders & outcomes<ChevronRight size={14} /></Link></div>
          </div>
          <div className={styles.card}>
            <p className={styles.railHeading}>A simpler daily routine</p>
            <ol className={styles.workflow}><li><span>1</span><div><strong>Catch up</strong><p>Check your recent customer conversations.</p></div></li><li><span>2</span><div><strong>Follow through</strong><p>Review a draft and reply yourself in WhatsApp.</p></div></li><li><span>3</span><div><strong>Keep track</strong><p>Record the outcome. See what’s moving.</p></div></li></ol>
          </div>
          <p className={styles.finePrint}><Clock3 size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />Your time zone: {workspace.timezone}.<br />Pipelixr never sends customer messages. Revenue is seller-recorded unless independently verified.</p>
        </aside>
      </div>
    </>
  );
}
