import LegalDocument from "@/components/LegalDocument";

export default function BillingPage() {
  return <LegalDocument title="Billing and Refund Terms" summary="These terms explain trials, recurring charges, usage allowances, cancellation, failed payments, and refunds for paid Pipelixr plans." sections={[
    { title: "Trial", paragraphs: ["A new eligible workspace receives the trial period and allowance shown at signup. No card is required and the trial does not convert to a paid plan automatically. At expiry, paid features may stop or become read-only unless you choose a plan."] },
    { title: "Recurring subscriptions", paragraphs: ["Monthly plans are billed monthly. Annual plans are charged upfront for a year at the displayed annual price. Paid plans renew automatically on the same interval until cancelled. Paystack processes payments. Any applicable taxes or provider charges will be shown where required before payment."] },
    { title: "Usage", paragraphs: ["The checkout shows included AI-assisted customer conversations and group limits. Allowances reset monthly, including for annual plans. Pipelixr does not automatically charge overage fees; a higher plan or separately approved purchase is required for additional paid usage."] },
    { title: "Cancellation", paragraphs: ["You can cancel renewal from Billing. Access continues through the paid period, after which paid features may become read-only. Cancellation does not ordinarily create a prorated refund for an already-started billing period."] },
    { title: "Refunds", paragraphs: ["Except where law requires otherwise, subscription payments are non-refundable once a billing period begins. Contact support promptly for duplicate charges, an incorrect amount, unauthorized payment, or a service failure that materially prevented use. Approved refunds are returned through the original payment method and may take the provider's processing time."] },
    { title: "Failed payments and price changes", paragraphs: ["Failed renewals may receive a limited grace period before paid features become read-only. We will give reasonable notice of material price changes; a new price applies no earlier than the next renewal after the stated notice period, unless you affirmatively purchase a different plan."] },
    { title: "No outcome guarantee", paragraphs: ["Fees pay for access to product capabilities, not a guaranteed level of sales, revenue, response, delivery, conversion, or return on investment. Revenue and outcomes entered by sellers are not independently verified unless labelled otherwise."] },
  ]} />;
}
