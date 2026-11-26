"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, BadgeDollarSign, CheckCheck, CircleHelp, Clock3, Receipt } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { formatDate, formatMoney, titleCase } from "@/lib/workspace-ui";
import { buttonClass, EmptyState, PageHeader, Pill, Segmented } from "./dashboard-ui";
import { LoadingRows, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

export default function CommerceOperations({ workspace }: { workspace: Workspace }) {
  const [tab, setTab] = useState<"questions" | "promises" | "issues" | "payments">("questions");
  const summary = useQuery(api.commerceIntelligence.dashboard, { businessId: workspace.businessId });
  const queue = useQuery(api.commerceIntelligence.workQueue, { businessId: workspace.businessId });
  const completeCommitment = useMutation(api.commerceIntelligence.completeCommitment);
  const resolveException = useMutation(api.commerceIntelligence.resolveException);
  const answerRescue = useMutation(api.commerceIntelligence.answerRescue);
  const resolveRescueDelivery = useMutation(api.commerceIntelligence.resolveRescueDelivery);
  const reviewPayment = useMutation(api.commerceIntelligence.reviewPaymentProof);
  const [busy, setBusy] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function run(id: string, action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(id); setFeedback(null);
    try { await action(); setFeedback({ text: success }); }
    catch (error) {
      const manual = error instanceof Error && error.message.includes("MANUAL_REPLY_REQUIRED");
      setFeedback({ text: manual ? "Pipelixr can't send this answer. Reply directly in the customer's WhatsApp chat." : "We couldn't save that update. Please try again.", error: true });
    }
    finally { setBusy(null); }
  }

  return <>
    <PageHeader title="Business operations" description="Questions, promises, customer problems, and payment receipts that need your attention." />
    <div className={styles.summaryRail}>
      <Summary label="Owner questions" value={summary?.ownerQuestions} icon={CircleHelp} />
      <Summary label="Open promises" value={summary?.openCommitments} icon={Clock3} />
      <Summary label="Customer issues" value={summary?.openExceptions} icon={AlertTriangle} />
      <Summary label="Payment reviews" value={summary?.pendingPaymentProofs} icon={Receipt} />
    </div>
    <div className={styles.toolbar}><Segmented label="Operations view" value={tab} onChange={setTab} options={[{ value: "questions", label: "Questions for you" }, { value: "promises", label: "Promises" }, { value: "issues", label: "Customer issues" }, { value: "payments", label: "Payment receipts" }]} /><Pill dot>Updates automatically</Pill></div>
    <Notice feedback={feedback} />
    {!workspace.aiEnabled && tab === "questions" && <div className={styles.infoBanner}><AlertTriangle size={18} aria-hidden="true" /><span>AI Assistant is off. Reply to customers in WhatsApp.</span></div>}
    {queue === undefined ? <LoadingRows label="Loading business operations" /> : tab === "questions" ? <section className={styles.stack}>{queue.rescues.length === 0 ? <EmptyState icon={CheckCheck} title="No questions for you" description="Pipelixr asks one clear question here when it needs a fact or approval." /> : queue.rescues.map((item) => <form key={item.id} className={styles.actionCard} onSubmit={(event) => { event.preventDefault(); void run(item.id, () => answerRescue({ businessId: workspace.businessId, rescueId: item.id, answer: answers[item.id] ?? item.ownerAnswer ?? "" }), "Pipelixr is preparing and sending your answer to the customer."); }}><div className={styles.itemHead}><CircleHelp size={18} /><div><strong>{item.customerName}</strong><p>{formatDate(item.createdAt, workspace.timezone)}</p></div><Pill tone={item.state === "delivery_unknown" ? "danger" : "warning"}>{item.state === "sending" ? "Sending answer" : item.state === "delivery_unknown" ? "Check WhatsApp" : "Needs your answer"}</Pill></div><p className={styles.quote}>{item.question}</p><p className={styles.itemMeta}>{item.contextSummary}</p>{item.deliveryError && <div className={styles.infoBanner}><AlertTriangle size={18} /><span>{item.deliveryError}</span></div>}{item.state === "open" && workspace.aiEnabled && <><label className={styles.field}>Your answer<textarea className={`${styles.input} ${styles.textarea}`} value={answers[item.id] ?? item.ownerAnswer ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Give Pipelixr the correct answer in simple words" /></label><div className={styles.actions}><button className={buttonClass.primary} disabled={busy !== null || ((answers[item.id] ?? item.ownerAnswer ?? "").trim().length < 2)}>{busy === item.id ? "Sending..." : "Generate and send reply"}</button></div></>}{item.state === "sending" && <p className={styles.itemMeta}>Pipelixr is turning your answer into a natural reply and delivering it safely.</p>}{item.state === "delivery_unknown" && <div className={styles.actions}><button type="button" className={buttonClass.primary} disabled={busy !== null} onClick={() => void run(item.id, () => resolveRescueDelivery({ businessId: workspace.businessId, rescueId: item.id, decision: "delivered" }), "Marked as delivered.")}>It was delivered</button><button type="button" className={buttonClass.secondary} disabled={busy !== null} onClick={() => void run(item.id, () => resolveRescueDelivery({ businessId: workspace.businessId, rescueId: item.id, decision: "not_delivered" }), "You can safely send the answer again.")}>It was not delivered</button></div>}</form>)}</section> : tab === "promises" ? <section className={styles.stack}>{queue.commitments.length === 0 ? <EmptyState icon={CheckCheck} title="No open promises" description="Promises made in chats appear here until they are completed." /> : queue.commitments.map((item) => <article key={item.id} className={styles.actionCard}><div className={styles.itemHead}><Clock3 size={18} /><div><strong>{item.customerName}</strong><p>{item.dueAt ? `Due ${formatDate(item.dueAt, workspace.timezone)}` : "No due time detected"}</p></div><Pill tone={item.state === "overdue" ? "danger" : "neutral"}>{titleCase(item.state)}</Pill></div><p className={styles.quote}>{item.summary}</p><div className={styles.actions}><button className={buttonClass.primary} disabled={busy !== null} onClick={() => void run(item.id, () => completeCommitment({ businessId: workspace.businessId, commitmentId: item.id, state: "completed" }), "Promise marked completed.")}>Done</button><button className={buttonClass.ghost} disabled={busy !== null} onClick={() => void run(item.id, () => completeCommitment({ businessId: workspace.businessId, commitmentId: item.id, state: "cancelled" }), "Promise removed from the queue.")}>Cancel</button></div></article>)}</section> : tab === "issues" ? <section className={styles.stack}>{queue.exceptions.length === 0 ? <EmptyState icon={CheckCheck} title="No customer issues" description="Complaints, delays, returns, damage, and payment failures appear here." /> : queue.exceptions.map((item) => <article key={item.id} className={styles.actionCard}><div className={styles.itemHead}><AlertTriangle size={18} /><div><strong>{item.customerName}</strong><p>{titleCase(item.kind)}</p></div><Pill tone={item.severity === "critical" || item.severity === "high" ? "danger" : "warning"}>{titleCase(item.severity)}</Pill></div><p className={styles.quote}>{item.summary}</p>{item.ownerQuestion && <p className={styles.itemMeta}><strong>Pipelixr needs:</strong> {item.ownerQuestion}</p>}<div className={styles.actions}><button className={buttonClass.primary} disabled={busy !== null} onClick={() => void run(item.id, () => resolveException({ businessId: workspace.businessId, exceptionId: item.id, state: "resolved" }), "Customer issue marked resolved.")}>Resolved</button><button className={buttonClass.secondary} disabled={busy !== null} onClick={() => void run(item.id, () => resolveException({ businessId: workspace.businessId, exceptionId: item.id, state: "waiting_on_customer" }), "Marked as waiting for the customer.")}>Waiting for customer</button><button className={buttonClass.ghost} disabled={busy !== null} onClick={() => void run(item.id, () => resolveException({ businessId: workspace.businessId, exceptionId: item.id, state: "dismissed" }), "Issue dismissed.")}>Dismiss</button></div></article>)}</section> : <section className={styles.stack}><div className={styles.infoBanner}><Receipt size={18} /><span>A screenshot or receipt is never treated as a confirmed payment unless an independent payment provider verifies it.</span></div>{queue.payments.length === 0 ? <EmptyState icon={CheckCheck} title="No payment receipts to review" description="New customer receipts appear here automatically." /> : queue.payments.map((item) => <article key={item.id} className={styles.actionCard}><div className={styles.itemHead}><BadgeDollarSign size={18} /><div><strong>{item.customerName}</strong><p>{formatDate(item.createdAt, workspace.timezone)}{item.amount ? ` · ${formatMoney(item.amount)}` : ""}</p></div><Pill tone={item.verificationState === "verified" ? "positive" : "warning"}>{item.verificationState === "verified" ? "Verified payment" : "Not verified"}</Pill></div><p className={styles.itemMeta}>{item.reason || "This receipt needs review."}</p>{item.verificationState !== "verified" && <div className={styles.actions}><button className={buttonClass.secondary} disabled={busy !== null} onClick={() => void run(item.id, () => reviewPayment({ businessId: workspace.businessId, proofId: item.id, decision: "keep_for_review" }), "Receipt kept for review. No payment was confirmed.")}>Keep for review</button><button className={buttonClass.ghost} disabled={busy !== null} onClick={() => void run(item.id, () => reviewPayment({ businessId: workspace.businessId, proofId: item.id, decision: "reject" }), "Receipt rejected as payment evidence.")}>Reject receipt</button></div>}</article>)}</section>}
  </>;
}

function Summary({ label, value, icon: Icon }: { label: string; value: number | undefined; icon: typeof CircleHelp }) {
  return <section className={styles.stat}><div><span>{label}</span><strong>{value ?? "-"}</strong></div><Icon size={18} aria-hidden="true" /></section>;
}
