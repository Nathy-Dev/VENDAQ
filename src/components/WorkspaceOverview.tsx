"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowRight, CheckCheck, ChevronRight, Clock3, ListTodo, MessageCircle, Settings, ShoppingBag, UsersRound, Sparkles, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { formatDate, formatMoney, initials } from "@/lib/workspace-ui";
import type { Workspace } from "@/types/workspace";
import { buttonClass, EmptyState, PageHeader, Panel, Pill, Stat, StatGrid } from "./dashboard-ui";
import { LoadingRows } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

export default function WorkspaceOverview({ workspace }: { workspace: Workspace }) {
  const { data: session } = useSession();
  const metrics = useQuery(api.measurement.dashboard, { businessId: workspace.businessId });
  const demo = useQuery(api.productAnalytics.demoState, { businessId: workspace.businessId });
  const recordDemo = useMutation(api.productAnalytics.recordDemo);
  const actions = useQuery(api.sellerActions.actionQueue, { businessId: workspace.businessId });
  const contacts = useQuery(api.foundation.customers, { businessId: workspace.businessId });
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const connected = workspace.state === "connected";

  return (
    <>
      <PageHeader eyebrow={workspace.name} title={firstName ? `Hey, ${firstName}.` : "Your day, at a glance."} description="A little less catching up. A little more moving forward."
        actions={<Link href="/pipeline" className={buttonClass.secondary}><MessageCircle size={15} />Open inbox</Link>} />
      <StatGrid>
        <Stat label="Leads captured" value={metrics?.leadsCaptured ?? "N/A"} hint="Customer-initiated conversations" icon={UsersRound} />
        <Stat label="Actions to review" value={actions?.length ?? "N/A"} hint="Ready for your attention" icon={ListTodo} />
        <Stat label="Recorded orders" value={metrics?.orders ?? "N/A"} hint="Entered by you" icon={ShoppingBag} />
        <Stat label="Claimed revenue" value={metrics ? formatMoney(metrics.claimedRecoveredRevenue) : "N/A"} hint="Seller-recorded, not independently verified" />
      </StatGrid>
      <div className={styles.overviewGrid}>
        <div className={styles.stack}>
          {!connected && <div className={styles.infoBanner}><MessageCircle size={18} /><div><strong>Your inbox is ready when you are.</strong><br />Connect WhatsApp to start capturing new conversations. <Link href="/onboarding/connect" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Review connection</Link></div></div>}
          {demo && !demo.completedAt && !demo.dismissedAt && <FirstFiveMinutes onComplete={() => void recordDemo({ businessId: workspace.businessId, outcome: "completed" })} onDismiss={() => void recordDemo({ businessId: workspace.businessId, outcome: "dismissed" })} />}
          {connected && !workspace.aiEnabled && <div className={styles.infoBanner}><MessageCircle size={18} /><div><strong>AI Assistant is off.</strong><br />WhatsApp messages still sync. <Link href="/pipeline" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Open your inbox</Link></div></div>}
          {connected && workspace.aiEnabled && !workspace.hasBusinessSystemPrompt && <div className={styles.infoBanner}><Sparkles size={18} /><div><strong>Set up your reply playbook.</strong><br />If you want auto-replies, teach Pipelixr about your business and choose a reply scope. <Link href="/settings" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Open settings</Link></div></div>}
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
          <p className={styles.finePrint}><Clock3 size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />Your time zone: {workspace.timezone}.<br />Pipelixr replies only where you explicitly authorize it and only after a complete reply playbook is saved. Revenue is seller-recorded unless independently verified.</p>
        </aside>
      </div>
    </>
  );
}

function FirstFiveMinutes({ onComplete, onDismiss }: { onComplete: () => void; onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    { title: "A buyer message arrives", body: '“Hi, I like the blue two-piece. Is medium still available and can you deliver to Surulere?”', badge: "Customer message" },
    { title: "Pipelixr finds the signal", body: "Buying signal · Product and delivery question · Suggested action: confirm stock and delivery terms.", badge: "Opportunity" },
    { title: "A grounded reply is prepared", body: "Yes, medium is available. Delivery to Surulere follows your saved delivery policy. Would you like to place the order?", badge: "Uses your playbook" },
    { title: "You keep the outcome", body: "Record a paid order, qualified lead, follow-up, or lost-sale reason so the workspace learns what moved forward.", badge: "Seller-recorded" },
  ];
  const current = steps[step];
  return <section className={styles.demoCard} aria-label="First five minutes preview"><div className={styles.demoHeader}><div><span>First five minutes</span><h2>Preview the workflow before real messages arrive.</h2></div><button type="button" onClick={onDismiss} aria-label="Dismiss preview"><X size={16} /></button></div><div className={styles.demoProgress}>{steps.map((_, index) => <i key={index} data-current={index <= step} />)}</div><div className={styles.demoScene}><Pill>{current.badge}</Pill><h3>{current.title}</h3><p>{current.body}</p></div><div className={styles.demoActions}><button type="button" className={buttonClass.ghost} disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>{step < steps.length - 1 ? <button type="button" className={buttonClass.primary} onClick={() => setStep((value) => value + 1)}>Next preview<ArrowRight size={13} /></button> : <button type="button" className={buttonClass.primary} onClick={onComplete}>Finish preview<CheckCheck size={13} /></button>}</div><p className={styles.finePrint}>This guided demo is illustrative and does not create fake customers or production conversations.</p></section>;
}
