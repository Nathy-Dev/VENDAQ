"use client";

import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CreditCard, ExternalLink, ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { PageHeader, Panel, Pill, Segmented, Stat, StatGrid, buttonClass } from "./dashboard-ui";
import styles from "./BillingWorkspace.module.css";

type Interval = "monthly" | "annual";
type Plan = "starter" | "growth";

const plans = {
  starter: { name: "Starter", monthly: 9_900, annual: 99_000, conversations: 300, groups: 0, automation: false, description: "For solo sellers who want a clean sales workspace and AI-assisted drafts." },
  growth: { name: "Growth", monthly: 24_900, annual: 249_000, conversations: 1_500, groups: 5, automation: true, description: "For busy sellers who want qualification, replies, follow-ups and payment recovery." },
} as const;

function money(amount: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
}

function date(value: number | null) {
  return value ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(value) : "N/A";
}

export default function BillingWorkspace() {
  const [billingNow, setBillingNow] = useState(() => Date.now());
  const overview = useQuery(api.billing.overview, { now: billingNow });
  const createCheckout = useAction(api.billing.createCheckout);
  const acceptLegal = useMutation(api.compliance.acceptLegal);
  const verifyCheckout = useAction(api.billing.verifyCheckout);
  const cancelSubscription = useAction(api.billing.cancelSubscription);
  const searchParams = useSearchParams();
  const reference = searchParams.get("reference") ?? searchParams.get("trxref");
  const verifiedRef = useRef<string | null>(null);
  const [interval, setInterval] = useState<Interval>("monthly");
  const [busy, setBusy] = useState<Plan | "cancel" | "verify" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [billingAccepted, setBillingAccepted] = useState(false);
  const usagePercent = useMemo(() => overview?.assistedConversationLimit ? Math.min(100, Math.round(overview.assistedConversationsUsed / overview.assistedConversationLimit * 100)) : 0, [overview]);

  useEffect(() => {
    const timer = window.setInterval(() => setBillingNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!reference || verifiedRef.current === reference) return;
    verifiedRef.current = reference;
    setBusy("verify");
    void verifyCheckout({ reference }).then((result) => {
      setMessage(result.active ? "Payment confirmed. Your subscription is active." : "Payment is still being confirmed. Refresh this page in a moment.");
    }).catch(() => setMessage("We could not confirm this payment yet. Your card will not be charged again by retrying verification.")).finally(() => setBusy(null));
  }, [reference, verifyCheckout]);

  async function checkout(plan: Plan) {
    if (!billingAccepted) { setMessage("Review and accept the Billing and Refund Terms before checkout."); return; }
    setBusy(plan); setMessage(null);
    try {
      await acceptLegal({ documents: ["billing"], method: "checkout_gate" });
      const result = await createCheckout({ plan, billingInterval: interval });
      window.location.assign(result.authorizationUrl);
    } catch {
      setMessage("Checkout could not be opened. Confirm your billing email or try again shortly.");
      setBusy(null);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel renewal? Your paid access will continue until the current period ends.")) return;
    setBusy("cancel"); setMessage(null);
    try { await cancelSubscription({}); setMessage("Renewal cancelled. Your workspace remains active until the period ends."); }
    catch { setMessage("Cancellation could not be completed automatically. Please contact support before your renewal date."); }
    finally { setBusy(null); }
  }

  if (overview === undefined) return <div className={styles.loading}>Loading billing…</div>;
  if (!overview) return null;

  const currentLabel = overview.plan === "trial" ? "Growth trial" : overview.plan === "none" ? "No active plan" : overview.plan[0].toUpperCase() + overview.plan.slice(1);
  const periodEnd = overview.trialEndsAt ?? overview.graceEndsAt ?? overview.currentPeriodEnd;

  return <div className={styles.page}>
    <PageHeader eyebrow="Billing" title="Choose the plan that fits your workload." description="Manage your subscription, usage and renewal. All charges are in naira and processed securely by Paystack. Results and revenue are not guaranteed." />
    {message && <div className={styles.notice} role="status">{message}</div>}
    {overview.readOnly && <div className={styles.warning} role="alert"><ShieldCheck size={18} /><div><strong>Your workspace is read-only.</strong><p>Choose a plan to resume AI processing and automation. Your existing records remain available.</p></div></div>}
    <StatGrid>
      <Stat label="Current plan" value={currentLabel} hint={overview.cancelAtPeriodEnd ? "Renewal cancelled" : overview.status.replaceAll("_", " ")} icon={CreditCard} tone={overview.readOnly ? "warning" : "positive"} />
      <Stat label="AI-assisted customer chats" value={`${overview.assistedConversationsUsed} / ${overview.assistedConversationLimit || 0}`} hint={`${usagePercent}% used this period`} />
      <Stat label="Period ends" value={date(periodEnd)} hint={overview.plan === "trial" ? "Trial expiry" : "Billing period"} />
      <Stat label="Automation" value={overview.automation ? "Included" : "Not included"} hint={overview.automation ? `Up to ${overview.enabledGroupLimit} enabled groups` : "Upgrade to Growth"} />
    </StatGrid>

    <div className={styles.controls}><Segmented value={interval} onChange={setInterval} label="Billing interval" options={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Annual, 2 months free" }]} /></div>
    <section className={styles.checkoutDisclosure}>
      <strong>Before checkout</strong>
      <p>Monthly plans renew monthly; annual plans are charged upfront and renew yearly. Cancel before renewal to stop the next charge. Included usage resets monthly, overages are not charged automatically, and refunds are limited as described in the terms.</p>
      <label><input type="checkbox" checked={billingAccepted} onChange={(event) => setBillingAccepted(event.target.checked)} /><span>I have reviewed and accept the <Link href="/legal/billing" target="_blank">Billing and Refund Terms</Link>, including recurring renewal, cancellation, usage, and refund rules.</span></label>
    </section>
    <div className={styles.planGrid}>
      {(Object.keys(plans) as Plan[]).map((key) => {
        const plan = plans[key];
        const amount = interval === "annual" ? plan.annual : plan.monthly;
        return <Panel key={key} className={key === "growth" ? styles.featured : undefined} title={plan.name} description={plan.description} action={key === "growth" ? <Pill tone="positive">Recommended</Pill> : undefined}>
          <div className={styles.price}>{money(amount)}<span>/{interval === "annual" ? "year" : "month"}</span></div>
          <ul className={styles.features}>
            <li><Check size={15} />1 connected WhatsApp number</li>
            <li><Check size={15} />{plan.conversations.toLocaleString()} AI-assisted customer chats</li>
            <li><Check size={15} />Lead capture, pipeline and revenue reporting</li>
            <li><Check size={15} />{plan.automation ? "Automated replies, qualification and follow-ups" : "AI-assisted reply drafts"}</li>
            <li><Check size={15} />{plan.groups ? `${plan.groups} enabled groups` : "One-to-one conversations"}</li>
          </ul>
          <button className={buttonClass.primary} onClick={() => void checkout(key)} disabled={busy !== null || !billingAccepted}>{busy === key ? "Opening secure checkout…" : `Choose ${plan.name}`}</button>
        </Panel>;
      })}
      <Panel title="Scale" description="For multi-number businesses that need higher limits, onboarding and operational support." action={<Pill>Custom</Pill>}>
        <div className={styles.price}>From {money(59_900)}<span>/month</span></div>
        <ul className={styles.features}><li><Check size={15} />3 WhatsApp numbers</li><li><Check size={15} />5,000 AI-assisted customer chats</li><li><Check size={15} />Advanced attribution and priority support</li><li><Check size={15} />Assisted onboarding</li></ul>
        <a className={buttonClass.secondary} href="mailto:sales@pipelixr.com?subject=Pipelixr%20Scale"><ExternalLink size={14} />Contact sales</a>
      </Panel>
    </div>

    {overview.canCancel && !overview.cancelAtPeriodEnd && <section className={styles.manage}><div><strong>Cancel renewal</strong><p>Your workspace remains active until {date(overview.currentPeriodEnd)}. It then becomes read-only; records are retained for 30 days before deletion eligibility.</p></div><button className={buttonClass.danger} onClick={() => void cancel()} disabled={busy !== null}>{busy === "cancel" ? "Cancelling…" : "Cancel renewal"}</button></section>}
    <p className={styles.finePrint}>Payments are confirmed from Paystack&apos;s API and signed webhooks. Usage add-ons are never charged without approval. Seller-entered revenue and outcomes are not independently verified. <Link href="/legal/billing">Billing terms</Link> · <Link href="/legal/terms">Service terms</Link></p>
  </div>;
}
