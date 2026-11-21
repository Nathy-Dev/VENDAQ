"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { BadgePercent, BookOpenCheck, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { titleCase } from "@/lib/workspace-ui";
import { buttonClass, EmptyState, Pill } from "./dashboard-ui";
import { LoadingRows, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

const knowledgeKinds = ["business_fact", "product", "price", "inventory", "delivery", "payment", "returns", "warranty", "policy", "faq"] as const;

export default function BusinessKnowledgeSettings({ workspace }: { workspace: Workspace }) {
  const knowledge = useQuery(api.commerceIntelligence.listKnowledge, { businessId: workspace.businessId });
  const negotiation = useQuery(api.commerceIntelligence.negotiationPolicy, { businessId: workspace.businessId });
  if (knowledge === undefined || negotiation === undefined) return <LoadingRows label="Loading business knowledge" />;
  return <BusinessKnowledgeForm key={negotiation?.id ?? "no-policy"} workspace={workspace} knowledge={knowledge} negotiation={negotiation} />;
}

function BusinessKnowledgeForm({ workspace, knowledge, negotiation }: {
  workspace: Workspace;
  knowledge: NonNullable<ReturnType<typeof useQuery<typeof api.commerceIntelligence.listKnowledge>>>;
  negotiation: NonNullable<ReturnType<typeof useQuery<typeof api.commerceIntelligence.negotiationPolicy>>> | null;
}) {
  const saveKnowledge = useMutation(api.commerceIntelligence.saveKnowledge);
  const archiveKnowledge = useMutation(api.commerceIntelligence.archiveKnowledge);
  const saveNegotiation = useMutation(api.commerceIntelligence.saveNegotiationPolicy);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<(typeof knowledgeKinds)[number]>("business_fact");
  const [discount, setDiscount] = useState(String(negotiation?.maximumDiscountPercent ?? 0));
  const [minimumPrice, setMinimumPrice] = useState(negotiation?.minimumPrice == null ? "" : String(negotiation.minimumPrice));
  const [freeDelivery, setFreeDelivery] = useState(negotiation?.freeDeliveryThreshold == null ? "" : String(negotiation.freeDeliveryThreshold));
  const [approvalBelow, setApprovalBelow] = useState(negotiation?.requireApprovalBelow == null ? "" : String(negotiation.requireApprovalBelow));
  const [bundles, setBundles] = useState(negotiation?.allowedBundles.join(", ") ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setFeedback(null);
    try { await action(); setFeedback({ text: success }); }
    catch { setFeedback({ text: "We couldn't save that change. Please check the details and try again.", error: true }); }
    finally { setBusy(false); }
  }

  const optionalMoney = (value: string) => value.trim() ? Number(value) : undefined;

  return <div className={styles.stack}>
    <section className={styles.card}>
      <div className={styles.sectionHeading}><div><h2>Verified business knowledge</h2><p>Simple facts Pipelixr can safely use when replying to customers.</p></div><BookOpenCheck size={18} /></div>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void run(async () => { await saveKnowledge({ businessId: workspace.businessId, title, content, kind, sourceType: "owner" }); setTitle(""); setContent(""); }, "Business knowledge saved."); }}>
        <div className={styles.formGrid}><label className={styles.field}>Short title<input className={styles.input} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Delivery within Lagos" /></label><label className={styles.field}>Type<select className={styles.input} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>{knowledgeKinds.map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}</select></label><label className={`${styles.field} ${styles.fullWidth}`}>Correct information<textarea className={`${styles.input} ${styles.textarea}`} value={content} maxLength={8000} onChange={(event) => setContent(event.target.value)} placeholder="We deliver within Lagos in 1 to 2 business days. Delivery fee depends on location and must be confirmed before payment." /></label></div>
        <div className={styles.formFooter}><button className={buttonClass.primary} disabled={busy || title.trim().length < 2 || content.trim().length < 3}>Add knowledge</button><p>Only add information you know is current and correct.</p></div>
      </form>
    </section>
    <section className={styles.card}>
      <div className={styles.sectionHeading}><div><h2>What Pipelixr knows</h2><p>Remove anything that is no longer correct.</p></div></div>
      {knowledge.length === 0 ? <EmptyState icon={BookOpenCheck} title="No verified facts yet" description="Add delivery, price, product, policy, and frequently asked question details above." /> : <ul className={styles.auditList}>{knowledge.map((item) => <li key={item.id}><div className={styles.itemBetween}><div><strong>{item.title}</strong><p>{item.content}</p></div><Pill>{titleCase(item.kind)}</Pill></div><div className={styles.actions}><button type="button" className={buttonClass.ghost} disabled={busy} onClick={() => void run(() => archiveKnowledge({ businessId: workspace.businessId, knowledgeId: item.id }), "Knowledge removed from customer replies.")}><Trash2 size={13} />Remove</button></div></li>)}</ul>}
    </section>
    <section className={styles.card}>
      <div className={styles.sectionHeading}><div><h2>Price and discount limits</h2><p>Tell Pipelixr what it may offer without asking you first.</p></div><BadgePercent size={18} /></div>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void run(() => saveNegotiation({ businessId: workspace.businessId, name: "Default customer pricing limits", maximumDiscountPercent: Number(discount), minimumPrice: optionalMoney(minimumPrice), freeDeliveryThreshold: optionalMoney(freeDelivery), requireApprovalBelow: optionalMoney(approvalBelow), allowedBundles: bundles.split(",").map((value) => value.trim()).filter(Boolean) }), "Price and discount limits saved."); }}>
        <div className={styles.formGrid}><label className={styles.field}>Largest discount Pipelixr may offer (%)<input className={styles.input} type="number" min="0" max="100" step="0.1" value={discount} onChange={(event) => setDiscount(event.target.value)} /></label><label className={styles.field}>Never sell below this amount (NGN)<input className={styles.input} type="number" min="0" step="1" value={minimumPrice} onChange={(event) => setMinimumPrice(event.target.value)} placeholder="Optional" /></label><label className={styles.field}>Free delivery from (NGN)<input className={styles.input} type="number" min="0" step="1" value={freeDelivery} onChange={(event) => setFreeDelivery(event.target.value)} placeholder="Optional" /></label><label className={styles.field}>Ask me before going below (NGN)<input className={styles.input} type="number" min="0" step="1" value={approvalBelow} onChange={(event) => setApprovalBelow(event.target.value)} placeholder="Optional" /></label><label className={`${styles.field} ${styles.fullWidth}`}>Bundles it may offer<input className={styles.input} value={bundles} onChange={(event) => setBundles(event.target.value)} placeholder="Example: Buy 2 shirts, get free Lagos delivery" /><span className={styles.fieldHelp}>Separate multiple bundles with commas.</span></label></div>
        <div className={styles.formFooter}><button className={buttonClass.primary} disabled={busy || !Number.isFinite(Number(discount)) || Number(discount) < 0 || Number(discount) > 100}>Save limits</button></div>
      </form>
    </section>
    <Notice feedback={feedback} />
  </div>;
}
