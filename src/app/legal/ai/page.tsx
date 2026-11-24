import LegalDocument from "@/components/LegalDocument";

export default function AiPage() {
  return <LegalDocument title="AI Transparency Notice" summary="Pipelixr uses automated systems to help businesses organize conversations, identify possible intent, retrieve configured business facts, and prepare or send authorized replies." sections={[
    { title: "How AI is used", bullets: ["Classify messages such as enquiries, buying signals, and payment-related messages.", "Summarize conversation context and suggest follow-up actions.", "Draft or, only in enabled scopes, send replies grounded in a business's saved instructions.", "Extract possible customer preferences, commitments, issues, and seller-review items."] },
    { title: "Limits", paragraphs: ["AI can misunderstand language, context, images, voice notes, intent, or business policy. Outputs may be inaccurate, incomplete, biased, or unsuitable. Pipelixr does not independently verify seller facts, revenue, product claims, customer identity, or payment unless explicitly stated."] },
    { title: "Human control", paragraphs: ["Businesses choose enabled scopes, business facts, guardrails, groups, and whether to use suggestions or automation. Sellers should review high-impact messages and remain responsible for offers, prices, fulfilment, refunds, consumer claims, and customer rights. Recipients can opt out of automated communication."] },
    { title: "Data and providers", paragraphs: ["Relevant message content and configured business context may be sent to listed AI subprocessors to generate requested results. Data is not sold. Retention and provider use are governed by the Privacy Notice, DPA, and subprocessor terms."] },
    { title: "Questions or challenges", paragraphs: ["Workspace owners can correct business knowledge and customer records. People affected by processing may contact the business they messaged or the privacy contact below to ask about, object to, or request review of relevant processing."] },
  ]} />;
}
