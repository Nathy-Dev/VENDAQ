"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, CheckCheck, Clock3, Copy, ExternalLink, ListTodo, Receipt, ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FollowUp, SellerAction, SellerOrder, Workspace } from "@/types/workspace";
import { formatDate, formatMoney, initials, titleCase } from "@/lib/workspace-ui";
import { buttonClass, EmptyState, PageHeader, Panel, Pill, Segmented, Stat, StatGrid } from "./dashboard-ui";
import { ConfirmDialog, LoadingRows, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

export default function SellerWorkspacePanels({ workspace }: { workspace: Workspace }) {
  const [tab, setTab] = useState<"queue" | "orders" | "revenue">("queue");
  return (
    <>
      <PageHeader title="A clear next step." description="Review a follow-up, keep track of an order, and see what comes next." />
      <div className={styles.toolbar}><Segmented label="Actions view" value={tab} onChange={setTab} options={[{ value: "queue", label: "Action queue" }, { value: "orders", label: "Orders" }, { value: "revenue", label: "Revenue" }]} /><Pill>Manual actions only</Pill></div>
      {tab === "queue" && <ActionQueue workspace={workspace} />}
      {tab === "orders" && <OrdersPanel workspace={workspace} />}
      {tab === "revenue" && <RevenuePanel workspace={workspace} />}
    </>
  );
}

function ActionQueue({ workspace }: { workspace: Workspace }) {
  const actions = useQuery(api.sellerActions.actionQueue, { businessId: workspace.businessId });
  const followUps = useQuery(api.followUps.queue, { businessId: workspace.businessId });
  const digest = useQuery(api.sellerActions.digestPreview, { businessId: workspace.businessId });
  const [filter, setFilter] = useState<"all" | "payment" | "signals">("all");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const filtered = actions?.filter((action) => filter === "all" || (filter === "payment" ? action.reason === "awaiting_payment" : action.reason === "buying_signal"));
  const deferred = followUps?.filter((entry) => !actions?.some((action) => action.taskId === entry.taskId));

  return (
    <div className={styles.stack}>
      <div className={styles.infoBanner}><ShieldCheck size={18} /><span>Review each draft against the current conversation. <strong>You send it yourself in WhatsApp.</strong> Recording a manual send is your claim, not a delivery receipt.</span></div>
      <div className={`${styles.toolbar} ${styles.toolbarTight}`}><Segmented label="Filter actions" value={filter} onChange={setFilter} options={[{ value: "all", label: `All${actions ? ` (${actions.length})` : ""}` }, { value: "payment", label: "Payments" }, { value: "signals", label: "Buying signals" }]} />
        <button className={buttonClass.ghost} disabled={!digest} onClick={async () => { try { if (digest) { await navigator.clipboard.writeText(digest.text); setFeedback({ text: "Daily summary copied. Nothing has been sent." }); } } catch { setFeedback({ text: "Clipboard access is unavailable. Please try again.", error: true }); } }}><Copy size={14} />Copy daily summary</button>
      </div>
      <Notice feedback={feedback} />
      {actions === undefined ? <LoadingRows label="Loading action queue" /> : filtered?.length === 0 ? <div className={styles.card}><EmptyState icon={CheckCheck} title={filter === "all" ? "All caught up" : "No actions in this filter"} description={filter === "all" ? "Your next steps appear when a payment or customer conversation needs attention." : "Try All to see your other pending actions."} /></div> :
        <ol className={styles.report} aria-label="Ranked action queue">{filtered?.map((entry) => <ActionRow key={entry.taskId} businessId={workspace.businessId} entry={entry} />)}</ol>}
      {followUps === undefined ? <div className={styles.loading} role="status">Loading other suggestions…</div> : Boolean(deferred?.length) && <section className={styles.stack} aria-labelledby="other-suggestions"><div className={styles.sectionHeading}><div><h2 id="other-suggestions">Other follow-up suggestions</h2><p>Some are deferred by your quiet hours, cooldown, or daily cap.</p></div><Clock3 size={17} /></div><ol className={styles.report}>{deferred?.map((entry) => <FollowUpRow key={entry.taskId} businessId={workspace.businessId} entry={entry} timezone={workspace.timezone} />)}</ol></section>}
    </div>
  );
}

function ActionRow({ businessId, entry }: { businessId: Id<"businesses">; entry: SellerAction }) {
  const recordManualSend = useMutation(api.sellerActions.recordManualSend);
  const skipTask = useMutation(api.sellerActions.skipTask);
  const markLost = useMutation(api.sellerActions.markLost);
  const createOrder = useMutation(api.sellerActions.createOrder);
  const [amount, setAmount] = useState<string>(entry.estimatedValue > 0 ? String(entry.estimatedValue) : "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmation, setConfirmation] = useState<"sent" | "lost" | "won" | null>(null);
  const value = Number(amount);
  const validValue = amount.trim() !== "" && Number.isSafeInteger(value) && value > 0 && value <= 1000000000;

  async function save(operation: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setFeedback(null);
    try { await operation(); setFeedback({ text: success }); setConfirmation(null); }
    catch { setFeedback({ text: "This action couldn't be saved. Refresh and try again.", error: true }); setConfirmation(null); }
    finally { setBusy(false); }
  }

  function confirmAction() {
    if (confirmation === "sent") void save(() => recordManualSend({ businessId, taskId: entry.taskId, idempotencyKey: actionKey("manual") }), "Manual send recorded. Delivery is not independently confirmed.");
    if (confirmation === "lost") void save(() => markLost({ businessId, taskId: entry.taskId, idempotencyKey: actionKey("lost") }), "Outcome recorded as lost.");
    if (confirmation === "won" && validValue) void save(() => createOrder({ businessId, customerId: entry.customerId, sourceTaskId: entry.taskId, totalAmount: value, status: "paid", idempotencyKey: actionKey("won") }), "Paid outcome recorded as a seller claim.");
  }

  return (
    <li className={styles.actionCard}>
      <div className={styles.itemHead}><span className={styles.avatar}>{initials(entry.customerName)}</span><div><strong>{entry.customerName}</strong><p>{titleCase(entry.journeyStage)}{entry.estimatedValue > 0 ? ` · ${formatMoney(entry.estimatedValue)}` : ""}</p></div><Pill>{entry.reason === "awaiting_payment" ? "Payment reminder" : entry.reason === "buying_signal" ? "Buying signal" : "Quiet inquiry"}</Pill></div>
      <p className={styles.itemMeta}>{entry.reasonText}</p>
      <blockquote className={styles.quote}>{entry.draftText}</blockquote>
      <div className={styles.actions}>
        <button className={buttonClass.secondary} disabled={busy} onClick={() => void save(() => navigator.clipboard.writeText(entry.draftText), "Draft copied. Check the conversation before sending.")}><Copy size={14} />Copy draft</button>
        {entry.routablePhone ? <a className={buttonClass.primary} href={`https://wa.me/${entry.routablePhone}?text=${encodeURIComponent(entry.draftText)}`} target="_blank" rel="noopener noreferrer">Open WhatsApp<ArrowUpRight size={14} /></a> : <Pill>Private identity · open WhatsApp manually</Pill>}
        <button className={buttonClass.ghost} disabled={busy} onClick={() => setConfirmation("sent")}>Record sent manually</button>
        <button className={buttonClass.ghost} disabled={busy} onClick={() => void save(() => skipTask({ businessId, taskId: entry.taskId, idempotencyKey: actionKey("skip") }), "Action skipped.")}>Skip</button>
      </div>
      <details className={styles.details}><summary>Conversation context & outcome</summary><div className={styles.detailsBody}><h3>Original message</h3><blockquote className={styles.quote}>{entry.triggerMessage}</blockquote><p className={styles.helper}>Priority score {entry.priorityScore}. This action is based on customer-initiated context, not an instruction to send.</p>
        <form className={styles.inlineForm} onSubmit={(event) => { event.preventDefault(); if (validValue) void save(() => createOrder({ businessId, customerId: entry.customerId, sourceTaskId: entry.taskId, totalAmount: value, status: "awaiting_payment", idempotencyKey: actionKey("order") }), "Order recorded as awaiting payment."); }}>
          <label>Order value (NGN)<input type="number" className={styles.input} min={1} max={1000000000} step={1} value={amount} placeholder="Enter amount" onChange={(event) => setAmount(event.target.value)} disabled={busy} required /></label><button className={buttonClass.secondary} disabled={busy || !validValue}>Create order</button><button type="button" className={buttonClass.secondary} disabled={busy || !validValue} onClick={() => setConfirmation("won")}>Record won / paid</button><button type="button" className={buttonClass.ghost} disabled={busy} onClick={() => setConfirmation("lost")}>Mark lost</button>
        </form><p className={styles.helper}>Orders and payments are seller-recorded, not independent payment confirmations.</p>
      </div></details>
      {feedback && <div className={styles.noticeOffset}><Notice feedback={feedback} /></div>}
      <ConfirmDialog open={confirmation !== null} onClose={() => setConfirmation(null)} onConfirm={confirmAction} busy={busy} danger={confirmation === "lost"}
        title={confirmation === "sent" ? "Already sent this in WhatsApp?" : confirmation === "won" ? "Record a paid outcome?" : "Mark this opportunity as lost?"}
        description={confirmation === "sent" ? "Only continue if you personally sent the message. Pipelixr records your statement, not provider-confirmed delivery." : confirmation === "won" ? `You're recording ${formatMoney(value)} as paid. This is your claim and isn't independently confirmed by a payment provider.` : "This records a lost outcome and closes this action. No customer message will be sent."}
        confirmLabel={confirmation === "sent" ? "Yes, record manual send" : confirmation === "won" ? "Record paid outcome" : "Mark lost"} />
    </li>
  );
}

function FollowUpRow({ businessId, entry, timezone }: { businessId: Id<"businesses">; entry: FollowUp; timezone: string }) {
  const markHandled = useMutation(api.followUps.markHandled);
  const skip = useMutation(api.followUps.skip);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const available = entry.availableAt <= Date.now();
  async function complete(operation: () => Promise<unknown>, text: string) {
    if (busy) return; setBusy(true); setFeedback(null);
    try { await operation(); setFeedback({ text }); } catch { setFeedback({ text: "This suggestion couldn't be updated. Please retry.", error: true }); } finally { setBusy(false); }
  }
  return <li className={styles.actionCard}>
    <div className={styles.itemHead}><span className={styles.avatar}>{initials(entry.customerName)}</span><div><strong>{entry.customerName}</strong><p>{titleCase(entry.journeyStage)}</p></div><Pill>{available ? "Ready to review" : "Scheduled"}</Pill></div>
    <blockquote className={styles.quote}>{entry.draftText}</blockquote><p className={styles.itemMeta}>{available ? "Available now" : `Available ${formatDate(entry.availableAt, timezone)}`} · {entry.draftSource === "ai" ? "Guarded draft" : "Safe template"}</p>
    <div className={styles.actions}><button className={buttonClass.secondary} disabled={busy || !available} onClick={() => void complete(() => navigator.clipboard.writeText(entry.draftText), "Draft copied. Review before sending.")}><Copy size={14} />Copy draft</button>{entry.routablePhone && available ? <a href={`https://wa.me/${entry.routablePhone}?text=${encodeURIComponent(entry.draftText)}`} className={buttonClass.primary} target="_blank" rel="noopener noreferrer">Open WhatsApp<ExternalLink size={13} /></a> : <span className={styles.helper}>{!entry.routablePhone ? "Open WhatsApp manually" : "Available after your policy window"}</span>}<button className={buttonClass.ghost} disabled={busy || !available} onClick={() => void complete(() => markHandled({ businessId, taskId: entry.taskId }), "Marked as handled outside Pipelixr.")}>Mark handled</button><button className={buttonClass.ghost} disabled={busy} onClick={() => void complete(() => skip({ businessId, taskId: entry.taskId }), "Suggestion skipped.")}>Skip</button></div>
    <details className={styles.details}><summary>Trigger & safety details</summary><blockquote className={styles.quote}>{entry.triggerMessage}</blockquote>{entry.guardrailCode && <p className={styles.helper}>Guardrail fallback: {entry.guardrailCode}</p>}</details>
    {feedback && <div className={styles.noticeOffset}><Notice feedback={feedback} /></div>}
  </li>;
}

function OrdersPanel({ workspace }: { workspace: Workspace }) {
  const orders = useQuery(api.sellerActions.orders, { businessId: workspace.businessId });
  const [filter, setFilter] = useState<"all" | "awaiting" | "paid">("all");
  const filtered = orders?.filter((order) => filter === "all" || (filter === "awaiting" ? order.status === "awaiting_payment" : ["paid", "processing", "shipped", "delivered"].includes(order.status)));
  return <div className={styles.stack}>
    <div className={styles.infoBanner}><Receipt size={18} /><span>Orders and payment statuses are recorded by you. They are not independently verified payment confirmations.</span></div>
    <div><Segmented label="Order filter" value={filter} onChange={setFilter} options={[{ value: "all", label: "All orders" }, { value: "awaiting", label: "Awaiting payment" }, { value: "paid", label: "Paid" }]} /></div>
    <Panel title="Your recorded orders" description="Create an order from a customer action in your queue." flush>
      {orders === undefined ? <div className={styles.panelPadding}><LoadingRows label="Loading orders" /></div> : filtered?.length === 0 ? <EmptyState icon={Receipt} title="No orders here yet" description="Record an order from the action queue to keep its payment and outcome together." /> :
        <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Seller-recorded orders</caption><thead><tr><th scope="col">Customer</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Update</th></tr></thead><tbody>{filtered?.map((order) => <OrderRow key={`${order.orderId}:${order.status}`} order={order} workspace={workspace} />)}</tbody></table></div>}
    </Panel>
  </div>;
}

function OrderRow({ order, workspace }: { order: SellerOrder; workspace: Workspace }) {
  const updateOrderStatus = useMutation(api.sellerActions.updateOrderStatus);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmation, setConfirmation] = useState<"paid" | "cancelled" | null>(null);
  async function update(status: "awaiting_payment" | "paid" | "cancelled") {
    if (busy) return; setBusy(true); setFeedback(null);
    try { await updateOrderStatus({ businessId: workspace.businessId, orderId: order.orderId, status, idempotencyKey: actionKey(`order-${status}`) }); setFeedback({ text: `Order recorded as ${titleCase(status).toLowerCase()}.` }); setConfirmation(null); }
    catch { setFeedback({ text: "This order can't be updated from its current state. Refresh and try again.", error: true }); setConfirmation(null); }
    finally { setBusy(false); }
  }
  return <tr><td><strong>{order.customerName}</strong><small>{formatDate(order.createdAt, workspace.timezone)}</small></td><td>{formatMoney(order.totalAmount)}</td><td><Pill tone={order.status === "paid" ? "positive" : "neutral"}>{titleCase(order.status)}</Pill></td><td><div className={styles.actions}>
    {["pending", "payment_failed", "expired"].includes(order.status) && <button className={buttonClass.ghost} disabled={busy} onClick={() => void update("awaiting_payment")}>Awaiting payment</button>}
    {["pending", "awaiting_payment"].includes(order.status) && <button className={buttonClass.secondary} disabled={busy} onClick={() => setConfirmation("paid")}>Mark paid</button>}
    {["delivered", "cancelled"].includes(order.status) ? null : <button className={buttonClass.ghost} disabled={busy} onClick={() => setConfirmation("cancelled")}>Cancel</button>}
  </div>{feedback && <div className={styles.noticeOffsetCompact}><Notice feedback={feedback} /></div>}<ConfirmDialog open={confirmation !== null} onClose={() => setConfirmation(null)} onConfirm={() => { if (confirmation) void update(confirmation); }} busy={busy} danger={confirmation === "cancelled"} title={confirmation === "paid" ? "Record this order as paid?" : "Cancel this recorded order?"} description={confirmation === "paid" ? `You're recording ${formatMoney(order.totalAmount)} as paid. This is seller-entered evidence, not independent payment confirmation.` : "This updates the order to cancelled. Any claimed revenue attribution may be reversed. No message will be sent."} confirmLabel={confirmation === "paid" ? "Record paid" : "Cancel order"} /></td></tr>;
}

function RevenuePanel({ workspace }: { workspace: Workspace }) {
  const metrics = useQuery(api.measurement.dashboard, { businessId: workspace.businessId });
  const audit = useQuery(api.measurement.attributionAudit, { businessId: workspace.businessId });
  const missed = useQuery(api.readOnly.missedRevenueReport, { businessId: workspace.businessId });
  return <div className={styles.stack}>
    <div className={styles.infoBanner}><ShieldCheck size={18} /><span><strong>Clarity over inflated numbers.</strong> Claimed revenue uses your recorded outcomes. Confirmed revenue remains zero until independent payment evidence is available.</span></div>
    <StatGrid><Stat label="Claimed recovered" value={metrics ? formatMoney(metrics.claimedRecoveredRevenue) : "—"} hint="Seller-recorded evidence" /><Stat label="Confirmed recovered" value={metrics ? formatMoney(metrics.confirmedRecoveredRevenue) : "—"} hint="Independent confirmation required" /><Stat label="Buyers replied" value={metrics?.buyersRepliedAfterFollowUp ?? "—"} hint="After a recorded follow-up" /><Stat label="Missed opportunities" value={metrics?.missedOpportunities ?? "—"} hint="Unanswered buying signals" /></StatGrid>
    {metrics?.mayBeTruncated && <p className={styles.helper} role="status">These metrics reached the {metrics.recordLimit}-record limit and may be incomplete.</p>}
    <Panel title="Revenue evidence" description="An auditable record of what was claimed, rejected, or reversed.">
      {audit === undefined ? <LoadingRows label="Loading revenue evidence" /> : audit.length === 0 ? <EmptyState icon={ListTodo} title="No attribution records yet" description="Revenue evidence appears when you record a paid outcome linked to a manual follow-up." /> : <ul className={styles.auditList}>{audit.map((entry) => <li key={entry.attributionId}><div className={styles.itemBetween}><strong>{formatMoney(entry.claimedValue)} claimed · {formatMoney(entry.confirmedValue)} confirmed</strong><Pill>{titleCase(entry.state)}</Pill></div><p>{entry.reason}</p><p>Manual send {formatDate(entry.manualSentAt, workspace.timezone)} · order won {formatDate(entry.orderWonAt, workspace.timezone)} · {entry.windowDays}-day attribution window</p></li>)}</ul>}
    </Panel>
    <Panel title="Missed buying signals" description="Unanswered messages past their response window. Not a recovered-revenue or sales-value estimate.">
      {missed === undefined ? <LoadingRows label="Loading missed buying signals" /> : missed.length === 0 ? <EmptyState icon={CheckCheck} title="No overdue buying signals" description="Messages that meet the report rules appear here if they pass their response deadline." /> : <ul className={styles.report}>{missed.map((entry) => <li className={styles.actionCard} key={entry.opportunityId}><div className={styles.itemHead}><span className={styles.avatar}>{initials(entry.customerName)}</span><div><strong>{entry.customerName}</strong><p>Due {formatDate(entry.dueAt, workspace.timezone)} · {entry.responseWindowMinutes}-minute window</p></div></div><blockquote className={styles.quote}>{entry.message}</blockquote><details className={styles.details}><summary>Classification evidence</summary><p className={styles.helper}>{Math.round(entry.classifierConfidence * 100)}% confidence · {entry.classifierVersion} · {entry.ruleIds.join(", ")}</p></details></li>)}</ul>}
    </Panel>
  </div>;
}

function actionKey(prefix: string) { return `${prefix}:${crypto.randomUUID()}`; }
