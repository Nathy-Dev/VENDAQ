"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Brain, CheckCheck, ChevronDown, ExternalLink, ImageIcon, Lightbulb, MessageCircle, Mic, Search, ShieldCheck, Tags, ThumbsDown, ThumbsUp, Trash2, TrendingUp, UsersRound } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { displayIdentity, formatDate, initials, titleCase, whatsappLink } from "@/lib/workspace-ui";
import type { LabelEntry, MessageClass, Workspace, WorkspaceContact } from "@/types/workspace";
import type { Id } from "../../convex/_generated/dataModel";
import { buttonClass, EmptyState, PageHeader, Pill, Segmented } from "./dashboard-ui";
import { ConfirmDialog, LoadingRows, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

const messageLabels: { value: MessageClass; label: string }[] = [
  { value: "buying_signal", label: "Buying signal" }, { value: "inquiry", label: "Inquiry" },
  { value: "payment_related", label: "Payment related" }, { value: "casual_noise", label: "Casual / noise" }, { value: "manual_review", label: "Manual review" },
];

const conversationOutcomes = [
  { value: "paid", label: "Sale paid" },
  { value: "booked", label: "Appointment booked" },
  { value: "qualified", label: "Qualified lead, manually confirmed" },
  { value: "abandoned", label: "Conversation abandoned" },
  { value: "lost_price", label: "Lost because of price" },
  { value: "lost_stock", label: "Lost because of stock" },
  { value: "lost_delivery", label: "Lost because of delivery" },
  { value: "resolved_support", label: "Support issue resolved" },
  { value: "unresolved_support", label: "Support issue unresolved" },
] as const;

type ConversationOutcome = typeof conversationOutcomes[number]["value"];

function outcomeLabel(value: ConversationOutcome): string {
  return conversationOutcomes.find((option) => option.value === value)?.label ?? titleCase(value);
}

export default function WorkspaceInbox({ workspace }: { workspace: Workspace }) {
  const [tab, setTab] = useState<"conversations" | "opportunities" | "insights" | "review">("conversations");
  return <>
    <PageHeader title="Your inbox" description="Conversations, opportunities, and business insights in one simple place." />
    <div className={styles.toolbar}><Segmented label="Inbox view" value={tab} onChange={setTab} options={[{ value: "conversations", label: "Conversations" }, { value: "opportunities", label: "Opportunities" }, { value: "insights", label: "Insights" }, { value: "review", label: "Review" }]} /><Pill dot>Live WhatsApp activity</Pill></div>
    {tab === "conversations" ? <Suspense fallback={<LoadingRows label="Loading conversations" />}><Conversations workspace={workspace} /></Suspense> : tab === "opportunities" ? <Opportunities workspace={workspace} /> : tab === "insights" ? <CommunityInsights workspace={workspace} /> : <MessageReview workspace={workspace} />}
  </>;
}

function Conversations({ workspace }: { workspace: Workspace }) {
  const contacts = useQuery(api.foundation.customers, { businessId: workspace.businessId });
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Id<"customers"> | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const initialContact = searchParams.get("contact");
  const selectedId = selected === undefined ? contacts?.find((contact) => contact.customerId === initialContact)?.customerId : selected;
  const selectedContact = contacts?.find((contact) => contact.customerId === selectedId);
  const filtered = contacts?.filter((contact) => `${contact.name} ${displayIdentity(contact.identity, contact.isGroup)}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className={styles.inbox} data-selected={Boolean(selectedContact)}>
    <section className={styles.contactPane} aria-label="Conversations">
      <div className={styles.contactPaneHeader}><label className={styles.search}><Search size={16} aria-hidden="true" /><span className="sr-only">Search conversations</span><input type="search" placeholder="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} /></label><p className={styles.helper}>{contacts === undefined ? "Loading…" : `${contacts.length} recent ${contacts.length === 1 ? "conversation" : "conversations"}`}</p></div>
      {contacts === undefined ? <div className={styles.loading} role="status">Loading contacts…</div> : filtered?.length === 0 ? <EmptyState icon={MessageCircle} title={search ? "No matches" : "No conversations yet"} description={search ? "Try a different name or phone number." : "New messages appear after you connect WhatsApp."} /> : <ul className={styles.contacts}>{filtered?.map((contact) => <li key={contact.customerId}><button className={styles.contactButton} aria-pressed={selectedId === contact.customerId} onClick={() => setSelected(contact.customerId)}><span className={styles.avatar}>{initials(contact.name)}</span><div><strong>{contact.name}</strong><p>{displayIdentity(contact.identity, contact.isGroup)}</p></div><time dateTime={new Date(contact.lastActivityAt).toISOString()}>{new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", timeZone: workspace.timezone }).format(contact.lastActivityAt)}</time></button></li>)}</ul>}
    </section>
    {selectedContact ? <Conversation key={selectedContact.customerId} workspace={workspace} contact={selectedContact} onBack={() => setSelected(null)} /> : <div className={styles.conversationEmpty}><EmptyState icon={MessageCircle} title="Your conversations, together" description="Select a customer or group to see the captured message history." /></div>}
  </div>;
}

function Conversation({ workspace, contact, onBack }: { workspace: Workspace; contact: WorkspaceContact; onBack: () => void }) {
  const messages = useQuery(api.foundation.messages, { businessId: workspace.businessId, customerId: contact.customerId });
  const intelligence = useQuery(api.commerceIntelligence.conversationIntelligence, contact.isGroup ? "skip" : { businessId: workspace.businessId, customerId: contact.customerId });
  const deleteCustomer = useMutation(api.foundation.deleteCustomer);
  const verifyMemory = useMutation(api.commerceIntelligence.verifyMemory);
  const completeCommitment = useMutation(api.commerceIntelligence.completeCommitment);
  const recordOutcome = useMutation(api.commerceIntelligence.recordOutcome);
  const replyFeedback = useMutation(api.productAnalytics.replyFeedback);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const messagesRef = useRef<HTMLOListElement>(null);
  const whatsapp = whatsappLink(contact.identity, contact.isGroup);
  useEffect(() => { const list = messagesRef.current; if (list) list.scrollTop = list.scrollHeight; }, [messages?.length]);
  async function removeContact() { if (deleting) return; setDeleting(true); setFeedback(null); try { await deleteCustomer({ businessId: workspace.businessId, customerId: contact.customerId }); setConfirmDelete(false); onBack(); } catch { setFeedback({ text: "We couldn't request deletion. Please try again.", error: true }); setConfirmDelete(false); } finally { setDeleting(false); } }
  return <section className={styles.conversation} aria-label={`Conversation with ${contact.name}`}>
    <header className={styles.conversationHeader}><button className={styles.mobileBack} aria-label="Back to conversations" onClick={onBack}><ArrowLeft size={20} /></button><span className={styles.avatar}>{initials(contact.name)}</span><div><strong>{contact.name}</strong><p>{displayIdentity(contact.identity, contact.isGroup)}</p></div><button className={buttonClass.ghost} aria-label="Delete stored contact data" title="Delete stored contact data" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></button></header>
    <Notice feedback={feedback} />
    {messages === undefined ? <div className={styles.loading} role="status">Loading messages…</div> : messages.length === 0 ? <EmptyState icon={MessageCircle} title="No retained messages" description="Older messages may have been removed under your retention policy." /> : <ol ref={messagesRef} className={styles.messages} aria-label="Message history">{messages.slice().reverse().map((message) => <li key={message.messageId} className={styles.message} data-role={message.role}><p className={styles.messageBubble}>{message.text || `[${message.type} message. View in WhatsApp]`}</p><div className={styles.messageMeta}><span>{message.role === "owner" ? message.assistantGenerated ? "Pipelixr" : "You" : message.role === "customer" ? contact.name : "System"}</span><span aria-hidden="true">·</span><time dateTime={new Date(message.timestamp).toISOString()}>{formatDate(message.timestamp, workspace.timezone)}</time></div>{message.assistantGenerated && <div className={styles.replyRating}><span>Was this reply supported by your business playbook?</span><button type="button" aria-pressed={message.replyFeedback === "correct"} onClick={() => void replyFeedback({ businessId: workspace.businessId, interactionId: message.messageId, rating: "correct" })}><ThumbsUp size={12} />Correct</button><button type="button" aria-pressed={message.replyFeedback === "wrong"} onClick={() => void replyFeedback({ businessId: workspace.businessId, interactionId: message.messageId, rating: "wrong" })}><ThumbsDown size={12} />Wrong</button><button type="button" aria-pressed={message.replyFeedback === "unsupported"} onClick={() => void replyFeedback({ businessId: workspace.businessId, interactionId: message.messageId, rating: "unsupported" })}>Unsupported</button></div>}{message.type === "audio" && <div style={{ marginTop: 5 }}><Pill><Mic size={11} />{message.transcriptionState === "pending" ? "Transcribing voice note" : message.transcriptionState === "completed" ? "Voice note transcribed" : message.transcriptionState === "failed" ? "Transcription needs review" : "Voice note"}</Pill></div>}{message.type === "image" && <div style={{ marginTop: 5 }}><Pill><ImageIcon size={11} />{message.imageAnalysisState === "pending" ? "Analyzing image" : message.imageAnalysisState === "completed" ? "Image analyzed" : message.imageAnalysisState === "failed" ? "Image needs review" : "Image"}</Pill></div>}{message.manualReview && message.type !== "audio" && message.type !== "image" && <div style={{ marginTop: 5 }}><Pill>Media or shortened message · review in WhatsApp</Pill></div>}</li>)}</ol>}
    {!contact.isGroup && intelligence?.conversationId && <ConversationOutcomeEditor key={`${intelligence.latestOutcome?.id ?? "new"}:${intelligence.latestOutcome?.occurredAt ?? 0}`} workspace={workspace} contact={contact} intelligence={intelligence} save={recordOutcome} />}
    {!contact.isGroup && intelligence?.qualification && <details className={`${styles.conversationIntelligence} ${styles.conversationQualification}`}><summary><ShieldCheck size={14} />Lead qualification <Pill tone={intelligence.qualification.status === "qualified" ? "positive" : intelligence.qualification.status === "not_qualified" ? "danger" : "neutral"}>{titleCase(intelligence.qualification.status)}</Pill></summary><div className={styles.detailsBody}><div className={styles.itemBetween}><div><strong>{intelligence.qualification.score}% complete</strong><p>{intelligence.qualification.fitReason || "Pipelixr is gathering the details your business requires."}</p></div></div>{intelligence.qualification.answers.length > 0 && <section><h3>Confirmed in the conversation</h3><ul className={styles.auditList}>{intelligence.qualification.answers.map((answer) => <li key={answer.field}><strong>{titleCase(answer.field)}</strong><p>{answer.value}</p></li>)}</ul></section>}{intelligence.qualification.missingFields.length > 0 && <p className={styles.helper}><strong>Still needed:</strong> {intelligence.qualification.missingFields.map(titleCase).join(", ")}</p>}</div></details>}
    {!contact.isGroup && intelligence && (intelligence.memories.length > 0 || intelligence.commitments.length > 0 || intelligence.payments.length > 0) && <details className={styles.conversationIntelligence}><summary><Brain size={14} />What Pipelixr remembers</summary><div className={styles.detailsBody}>{intelligence.memories.length > 0 && <section><h3>Customer details to confirm</h3><ul className={styles.auditList}>{intelligence.memories.map((memory) => <li key={memory.id}><div className={styles.itemBetween}><div><strong>{titleCase(memory.key)}</strong><p>{memory.value}</p></div><Pill tone={memory.state === "verified" ? "positive" : "neutral"}>{titleCase(memory.state)}</Pill></div>{memory.state !== "verified" && memory.state !== "forgotten" && <div className={styles.actions}><button className={buttonClass.secondary} onClick={() => void verifyMemory({ businessId: workspace.businessId, memoryId: memory.id, state: "verified" })}>Confirm</button><button className={buttonClass.ghost} onClick={() => void verifyMemory({ businessId: workspace.businessId, memoryId: memory.id, state: "forgotten" })}>Forget</button></div>}</li>)}</ul></section>}{intelligence.commitments.length > 0 && <section><h3>Open promises</h3><ul className={styles.auditList}>{intelligence.commitments.map((item) => <li key={item.id}><div className={styles.itemBetween}><div><strong>{item.summary}</strong><p>{item.dueAt ? formatDate(item.dueAt, workspace.timezone) : "No due time detected"}</p></div><Pill tone={item.state === "overdue" ? "danger" : "neutral"}>{titleCase(item.state)}</Pill></div><div className={styles.actions}><button className={buttonClass.secondary} onClick={() => void completeCommitment({ businessId: workspace.businessId, commitmentId: item.id, state: "completed" })}><CheckCheck size={13} />Done</button></div></li>)}</ul></section>}{intelligence.payments.length > 0 && <section><h3>Payment receipts</h3><ul className={styles.auditList}>{intelligence.payments.map((proof) => <li key={proof.id}><strong>{proof.verificationState === "verified" ? "Independently verified" : "Not verified"}</strong><p>{proof.reason || "Receipt saved for review."}</p></li>)}</ul></section>}</div></details>}
    <footer className={styles.conversationFooter}><span>{contact.isGroup ? "Group conversation" : "Latest 100 retained messages"}</span>{whatsapp ? <a href={whatsapp} className={buttonClass.secondary} target="_blank" rel="noopener noreferrer">Open WhatsApp<ExternalLink size={13} /></a> : <span>Open WhatsApp manually</span>}</footer>
    <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => void removeContact()} busy={deleting} title="Delete stored contact data?" description="This removes the stored conversation from Pipelixr and prevents re-import. It does not delete messages from WhatsApp." confirmLabel="Delete contact data" />
  </section>;
}

type ConversationIntelligence = NonNullable<ReturnType<typeof useQuery<typeof api.commerceIntelligence.conversationIntelligence>>>;
type SaveConversationOutcome = ReturnType<typeof useMutation<typeof api.commerceIntelligence.recordOutcome>>;

function ConversationOutcomeEditor({ workspace, contact, intelligence, save }: { workspace: Workspace; contact: WorkspaceContact; intelligence: ConversationIntelligence; save: SaveConversationOutcome }) {
  const current = intelligence.latestOutcome;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [outcome, setOutcome] = useState<ConversationOutcome | "">(current?.outcome ?? "");
  const [value, setValue] = useState(current?.value ? String(current.value) : "");
  const [objection, setObjection] = useState(current?.objection ?? "");
  const [campaign, setCampaign] = useState(current?.sourceCampaignId ?? current?.sourceAdId ?? "");
  const [busy, setBusy] = useState(false);
  const [resultFeedback, setResultFeedback] = useState<Feedback>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!outcome || busy || !intelligence.conversationId) return;
    const parsedValue = value.trim() ? Number(value) : undefined;
    if (outcome === "paid" && parsedValue !== undefined && (!Number.isFinite(parsedValue) || parsedValue < 0)) {
      setResultFeedback({ text: "Enter a valid sale value.", error: true });
      return;
    }
    setBusy(true);
    setResultFeedback(null);
    try {
      await save({
        businessId: workspace.businessId,
        customerId: contact.customerId,
        conversationId: intelligence.conversationId,
        outcome,
        ...(outcome === "paid" && parsedValue !== undefined ? { value: Math.round(parsedValue) } : {}),
        ...(objection.trim() ? { objection: objection.trim() } : {}),
        ...(campaign.trim() ? { sourceCampaignId: campaign.trim() } : {}),
      });
      setResultFeedback({ text: current ? "Result updated." : "Result recorded." });
    } catch {
      setResultFeedback({ text: "We couldn't save this result. Please try again.", error: true });
      if (detailsRef.current) detailsRef.current.open = true;
    } finally {
      setBusy(false);
    }
  }

  return <details ref={detailsRef} className={`${styles.conversationIntelligence} ${styles.conversationOutcome}`}>
    <summary><TrendingUp size={14} /><span className={styles.disclosureLabel}>Record result</span>{current && <Pill tone={current.outcome === "paid" ? "positive" : "neutral"}>{outcomeLabel(current.outcome)}</Pill>}<ChevronDown className={styles.disclosureChevron} size={15} aria-hidden="true" /></summary>
    <form className={`${styles.form} ${styles.outcomeForm}`} onSubmit={submit}>
      <div className={styles.formGrid}>
        <label className={styles.field}>Result<select className={styles.input} value={outcome} disabled={busy} onChange={(event) => setOutcome(event.target.value as ConversationOutcome | "")}><option value="">Choose what happened</option>{conversationOutcomes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className={styles.fieldHelp}>Qualified means your business has personally confirmed the lead is a real fit.</span></label>
        {outcome === "paid" && <label className={styles.field}>Sale value, optional<input className={styles.input} inputMode="numeric" placeholder="For example, 25000" value={value} disabled={busy} onChange={(event) => setValue(event.target.value.replace(/[^0-9]/g, ""))} /></label>}
        <label className={styles.field}>Reason or objection, optional<input className={styles.input} placeholder="For example, delivery fee" value={objection} disabled={busy} onChange={(event) => setObjection(event.target.value)} /></label>
        <label className={styles.field}>Ad or campaign name, optional<input className={styles.input} placeholder="For example, Black Friday Instagram" value={campaign} disabled={busy} onChange={(event) => setCampaign(event.target.value)} /></label>
      </div>
      <div className={styles.formFooter}><button className={buttonClass.primary} disabled={busy || !outcome}>{busy ? "Saving…" : current ? "Update result" : "Save result"}</button><p>This updates the result for this conversation and your Insights report.</p></div>
      <Notice feedback={resultFeedback} />
    </form>
  </details>;
}

function Opportunities({ workspace }: { workspace: Workspace }) {
  const opportunities = useQuery(api.communityEngine.list, { businessId: workspace.businessId, includeClosed: false });
  if (opportunities === undefined) return <LoadingRows label="Loading opportunities" />;
  return <section className={styles.stack} aria-label="Opportunity inbox"><div className={styles.infoBanner}><TrendingUp size={18} /><span>Buying interest, questions, commitments, and complaints from enabled groups and private chats appear here with the original message as evidence.</span></div>{opportunities.length === 0 ? <div className={styles.card}><EmptyState icon={TrendingUp} title="No opportunities need attention" description="Relevant WhatsApp messages will appear here automatically." /></div> : opportunities.map((opportunity) => <OpportunityCard key={opportunity.opportunityId} workspace={workspace} opportunity={opportunity} />)}</section>;
}

type Opportunity = NonNullable<ReturnType<typeof useQuery<typeof api.communityEngine.list>>>[number];

function OpportunityCard({ workspace, opportunity }: { workspace: Workspace; opportunity: Opportunity }) {
  const update = useMutation(api.communityEngine.update);
  const recordOutcome = useMutation(api.communityEngine.recordOutcome);
  const setPrivateHandoff = useMutation(api.communityEngine.setPrivateHandoff);
  const consentCandidates = useQuery(api.communityEngine.handoffConsentCandidates, opportunity.sourceType === "group" ? { businessId: workspace.businessId, opportunityId: opportunity.opportunityId } : "skip");
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [consentMessageId, setConsentMessageId] = useState("");
  const handoffLink = opportunity.participantJid ? whatsappLink(opportunity.participantJid) : null;
  async function run(action: () => Promise<unknown>, success: string) { if (busy) return; setBusy(true); setFeedback(null); try { await action(); setFeedback({ text: success }); } catch { setFeedback({ text: "We couldn't save that update. Please try again.", error: true }); } finally { setBusy(false); } }
  return <article className={styles.actionCard}><div className={styles.itemHead}><span className={styles.avatar}>{opportunity.sourceType === "group" ? <UsersRound size={15} /> : initials(opportunity.customerName)}</span><div><strong>{opportunity.participantName || opportunity.customerName}</strong><p>{opportunity.sourceType === "group" ? `From ${opportunity.sourceName}` : "Private chat"} · {formatDate(opportunity.createdAt, workspace.timezone)}</p></div><Pill tone={opportunity.urgency === "high" ? "danger" : opportunity.category === "complaint" ? "warning" : "positive"}>{opportunity.category === "opportunity" ? "Sales opportunity" : opportunity.category}</Pill></div><blockquote className={styles.quote}>{opportunity.evidenceText}</blockquote>{opportunity.isTranscript && <p className={styles.itemMeta}><Mic size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />Transcribed from a voice note</p>}<p className={styles.itemMeta}><strong>Why it matters:</strong> {opportunity.reason}<br /><strong>Suggested next step:</strong> {opportunity.suggestedNextStep}</p>{opportunity.privateHandoffState === "suggested" && <label className={styles.field}>Message where they agreed<select className={styles.input} value={consentMessageId} onChange={(event) => setConsentMessageId(event.target.value)}><option value="">{consentCandidates?.length ? "Choose their consent message" : "No clear consent message yet"}</option>{consentCandidates?.map((candidate) => <option key={candidate.interactionId} value={candidate.interactionId}>{candidate.text}</option>)}</select><span className={styles.fieldHelp}>Ask in the group first. Pipelixr records their clear “yes” before private chat is allowed.</span></label>}<div className={styles.actions}>{opportunity.state === "open" && <button className={buttonClass.secondary} disabled={busy} onClick={() => void run(() => update({ businessId: workspace.businessId, opportunityId: opportunity.opportunityId, state: "in_progress" }), "Marked as being handled.")}>I’m handling this</button>}{opportunity.privateHandoffState === "suggested" && <><button className={buttonClass.secondary} disabled={busy || !consentMessageId} onClick={() => void run(() => setPrivateHandoff({ businessId: workspace.businessId, opportunityId: opportunity.opportunityId, state: "consented", consentInteractionId: consentMessageId as Id<"interactions"> }), "Consent evidence recorded. You can now move the conversation privately.")}>Confirm private-chat consent</button><button className={buttonClass.ghost} disabled={busy} onClick={() => void run(() => setPrivateHandoff({ businessId: workspace.businessId, opportunityId: opportunity.opportunityId, state: "declined" }), "Kept in the group.")}>Keep it in the group</button></>}{opportunity.privateHandoffState === "consented" && handoffLink && <a className={buttonClass.secondary} href={handoffLink} target="_blank" rel="noopener noreferrer">Open private chat<ExternalLink size={13} /></a>}<form className={styles.inlineForm} onSubmit={(event) => { event.preventDefault(); const amount = value.trim() ? Math.round(Number(value)) : 0; void run(() => recordOutcome({ businessId: workspace.businessId, opportunityId: opportunity.opportunityId, outcome: "won", value: amount }), "Recorded as won and attributed to its source."); }}><label>Sale value<input className={styles.input} inputMode="numeric" placeholder="Optional amount" value={value} onChange={(event) => setValue(event.target.value.replace(/[^0-9]/g, ""))} /></label><button className={buttonClass.primary} disabled={busy}>Won</button></form><button className={buttonClass.ghost} disabled={busy} onClick={() => void run(() => recordOutcome({ businessId: workspace.businessId, opportunityId: opportunity.opportunityId, outcome: "lost" }), "Recorded as lost.")}>Lost</button><button className={buttonClass.ghost} disabled={busy} onClick={() => void run(() => update({ businessId: workspace.businessId, opportunityId: opportunity.opportunityId, state: "dismissed" }), "Dismissed.")}>Not relevant</button></div><Notice feedback={feedback} /></article>;
}

function CommunityInsights({ workspace }: { workspace: Workspace }) {
  const insights = useQuery(api.communityEngine.insights, { businessId: workspace.businessId });
  const privateInsights = useQuery(api.commerceIntelligence.insights, { businessId: workspace.businessId });
  const qualificationInsights = useQuery(api.leadQualification.insights, { businessId: workspace.businessId });
  const suggestions = useQuery(api.communityEngine.knowledge, { businessId: workspace.businessId });
  if (!insights || !privateInsights || !qualificationInsights || suggestions === undefined) return <LoadingRows label="Loading business insights" />;
  const money = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(value);
  return <div className={styles.reviewGrid}><section className={styles.stack}><section className={styles.card}><div className={styles.sectionHeading}><div><h2>Automatic lead qualification</h2><p>Pipelixr qualifies one-to-one leads from confirmed conversation details.</p></div><ShieldCheck size={18} /></div><div className={styles.metrics}>{[{ label: "Qualified", value: qualificationInsights.qualified }, { label: "Still qualifying", value: qualificationInsights.active }, { label: "Not qualified", value: qualificationInsights.notQualified }, { label: "Needs attention", value: qualificationInsights.stalled }, { label: "Opted out", value: qualificationInsights.optedOut }, { label: "Average completion", value: `${qualificationInsights.averageScore}%` }].map((metric) => <div className={styles.metric} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}</div>{qualificationInsights.topMissingFields.length > 0 && <div className={styles.qualificationGap}><strong>Most common details still missing</strong><p>{qualificationInsights.topMissingFields.map((item) => `${item.label} (${item.count})`).join(", ")}</p></div>}</section><section className={styles.card}><div className={styles.sectionHeading}><div><h2>Private-chat results</h2><p>Results your business or Pipelixr has recorded from one-to-one conversations.</p></div><TrendingUp size={18} /></div><div className={styles.metrics}>{[{ label: "Paid", value: privateInsights.paid }, { label: "Booked", value: privateInsights.booked }, { label: "Qualified", value: privateInsights.qualified }, { label: "Lost or abandoned", value: privateInsights.lost }, { label: "Support resolved", value: privateInsights.resolvedSupport }, { label: "Support unresolved", value: privateInsights.unresolvedSupport }].map((metric) => <div className={styles.metric} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}</div></section><div className={styles.metrics}>{[{ label: "Open opportunities", value: insights.open }, { label: "Won", value: insights.won }, { label: "Unanswered questions", value: insights.unansweredQuestions }, { label: "Complaints needing care", value: insights.complaints }].map((metric) => <div className={styles.metric} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}</div><section className={styles.card}><div className={styles.sectionHeading}><div><h2>What people are asking for</h2><p>Demand seen across enabled groups and private chats.</p></div><TrendingUp size={18} /></div>{insights.topDemand.length ? <ul className={styles.auditList}>{insights.topDemand.map((item) => <li key={item.topic}><strong>{item.topic}</strong><p>{item.count} relevant {item.count === 1 ? "message" : "messages"}</p></li>)}</ul> : <EmptyState icon={TrendingUp} title="No demand pattern yet" description="Patterns appear as relevant messages are captured." />}</section><section className={styles.card}><div className={styles.sectionHeading}><div><h2>Ads and campaigns producing results</h2><p>Paid conversations and value attributed to the name entered when recording a result.</p></div><TrendingUp size={18} /></div>{privateInsights.topAds.length ? <ul className={styles.auditList}>{privateInsights.topAds.map((source) => <li key={source.adId}><strong>{source.adId}</strong><p>{source.paid} paid from {source.conversations} recorded {source.conversations === 1 ? "conversation" : "conversations"} · {money(source.value)} paid value</p></li>)}</ul> : <EmptyState icon={TrendingUp} title="No ad results recorded yet" description="Add an ad or campaign name when you record a private-chat result." />}</section><section className={styles.card}><div className={styles.sectionHeading}><div><h2>Groups driving results</h2><p>Recorded revenue attributed to the original community source.</p></div><UsersRound size={18} /></div>{insights.topGroups.length ? <ul className={styles.auditList}>{insights.topGroups.map((group) => <li key={group.groupName}><strong>{group.groupName}</strong><p>{group.opportunities} opportunities · {money(group.revenue)} recorded revenue</p></li>)}</ul> : <EmptyState icon={UsersRound} title="No group outcomes yet" description="Mark opportunities won to see which communities contribute revenue." />}</section></section><aside className={styles.stack}><section className={styles.card}><div className={styles.sectionHeading}><div><h2>Recorded value</h2><p>Only private chats marked paid count toward private-chat value.</p></div></div><div className={styles.metrics}><div className={styles.metric}><strong>{money(privateInsights.recordedValue)}</strong><span>Paid private chats</span></div><div className={styles.metric}><strong>{money(insights.groupRevenue)}</strong><span>From groups</span></div></div></section><section className={styles.card}><div className={styles.sectionHeading}><div><h2>Lost-sale reasons</h2><p>Reasons entered when conversations did not convert.</p></div></div>{privateInsights.topObjections.length ? <ul className={styles.auditList}>{privateInsights.topObjections.map((item) => <li key={item.objection}><strong>{item.objection}</strong><p>{item.count} recorded {item.count === 1 ? "conversation" : "conversations"}</p></li>)}</ul> : <EmptyState icon={TrendingUp} title="No reasons recorded yet" description="Add an optional reason when recording a conversation result." />}</section><KnowledgeReview workspace={workspace} suggestions={suggestions} /></aside></div>;
}

function KnowledgeReview({ workspace, suggestions }: { workspace: Workspace; suggestions: NonNullable<ReturnType<typeof useQuery<typeof api.communityEngine.knowledge>>> }) {
  const review = useMutation(api.communityEngine.reviewKnowledge);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  return <section className={styles.card}><div className={styles.sectionHeading}><div><h2>Teach Pipelixr</h2><p>Approve only facts you know are correct.</p></div><Lightbulb size={18} /></div>{suggestions.length === 0 ? <EmptyState icon={Lightbulb} title="Nothing to teach right now" description="Unanswered questions will appear here for your approval." /> : <div className={styles.stack}>{suggestions.map((suggestion) => <form key={suggestion.suggestionId} className={styles.form} onSubmit={async (event) => { event.preventDefault(); setBusy(suggestion.suggestionId); try { await review({ businessId: workspace.businessId, suggestionId: suggestion.suggestionId, decision: "approved", answer: answers[suggestion.suggestionId] ?? "" }); } finally { setBusy(null); } }}><p className={styles.helper}><strong>Customer asked:</strong> {suggestion.question}</p><label className={styles.field}>Your verified answer<textarea className={`${styles.input} ${styles.textarea}`} placeholder="Write the correct answer in simple words" value={answers[suggestion.suggestionId] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [suggestion.suggestionId]: event.target.value }))} /></label><div className={styles.actions}><button className={buttonClass.primary} disabled={busy !== null || (answers[suggestion.suggestionId]?.trim().length ?? 0) < 10}>{busy === suggestion.suggestionId ? "Saving…" : "Add to business knowledge"}</button><button type="button" className={buttonClass.ghost} disabled={busy !== null} onClick={() => void review({ businessId: workspace.businessId, suggestionId: suggestion.suggestionId, decision: "rejected" })}>Dismiss</button></div></form>)}</div>}</section>;
}

function MessageReview({ workspace }: { workspace: Workspace }) {
  const queue = useQuery(api.readOnly.labelQueue, { businessId: workspace.businessId });
  const evaluation = useQuery(api.readOnly.evaluation, { businessId: workspace.businessId });
  return <div className={styles.reviewGrid}><section className={styles.stack} aria-label="Messages to review"><div className={styles.infoBanner}><Tags size={18} /><span>Help keep message classification accurate. Your labels are used for evaluation only.</span></div>{queue === undefined ? <LoadingRows label="Loading message review queue" /> : queue.length === 0 ? <div className={styles.card}><EmptyState icon={Tags} title="Nothing to review yet" description="Customer messages that can be classified appear here after capture." /></div> : queue.map((entry) => <LabelRow key={`${entry.interactionId}:${entry.humanLabel}`} entry={entry} businessId={workspace.businessId} />)}</section><aside className={styles.card}><div className={styles.sectionHeading}><div><h2>Classification quality</h2><p>Measured against your labeled sample.</p></div><ShieldCheck size={18} /></div>{evaluation ? <><div className={styles.metrics}>{[{ label: "Labeled messages", value: evaluation.samples }, { label: "Precision", value: percent(evaluation.precision) }, { label: "Recall", value: percent(evaluation.recall) }, { label: "F1 score", value: percent(evaluation.f1) }].map((metric) => <div className={styles.metric} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}</div><p className={styles.helper}>Version {evaluation.version}</p></> : <div className={styles.loading} role="status">Loading evaluation…</div>}</aside></div>;
}

function LabelRow({ entry, businessId }: { entry: LabelEntry; businessId: Id<"businesses"> }) {
  const setLabel = useMutation(api.readOnly.setLabel);
  const [label, setSelectedLabel] = useState<MessageClass>(entry.humanLabel ?? entry.prediction);
  const [language, setLanguage] = useState(entry.language ?? "english");
  const [sellerVertical, setSellerVertical] = useState(entry.sellerVertical ?? "");
  const [evidenceTags, setEvidenceTags] = useState<Array<"voice_note" | "product_image" | "payment_receipt" | "ambiguous_language">>(entry.evidenceTags);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  function toggleTag(tag: "voice_note" | "product_image" | "payment_receipt" | "ambiguous_language") { setEvidenceTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]); }
  return <article className={styles.labelRow}><div className={styles.itemHead}><span className={styles.avatar}>{initials(entry.customerName)}</span><div><strong>{entry.customerName}</strong><p>{entry.humanLabel ? "Previously reviewed" : "Ready to review"}</p></div><Pill>{messageLabels.find((option) => option.value === entry.prediction)?.label} · {percent(entry.confidence)}</Pill></div><blockquote className={styles.quote}>{entry.message || `[${entry.messageType} message. View in WhatsApp]`}</blockquote><form className={styles.labelForm} onSubmit={async (event) => { event.preventDefault(); if (saving) return; setSaving(true); setFeedback(null); try { await setLabel({ businessId, interactionId: entry.interactionId, label, language, evidenceTags, sellerVertical }); setFeedback({ text: "Label and learning context saved. Thank you for reviewing." }); } catch { setFeedback({ text: "We couldn't save this label. Please retry.", error: true }); } finally { setSaving(false); } }}><div className={styles.inlineForm}><label>Your label<select className={styles.input} value={label} onChange={(event) => setSelectedLabel(event.target.value as MessageClass)} disabled={saving}>{messageLabels.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Language<select className={styles.input} value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}><option value="english">English</option><option value="pidgin">Pidgin</option><option value="mixed">Mixed</option><option value="other">Other</option></select></label><label>Seller vertical<input className={styles.input} value={sellerVertical} maxLength={80} placeholder="e.g. fashion" onChange={(event) => setSellerVertical(event.target.value)} /></label></div><div className={styles.labelTags}>{([['voice_note','Voice note'],['product_image','Product image'],['payment_receipt','Payment receipt'],['ambiguous_language','Ambiguous language']] as const).map(([tag, text]) => <label key={tag}><input type="checkbox" checked={evidenceTags.includes(tag)} onChange={() => toggleTag(tag)} />{text}</label>)}</div><button className={buttonClass.primary} disabled={saving}>{saving ? "Saving…" : "Save learning label"}</button></form><Notice feedback={feedback} /></article>;
}

function percent(value: number) { return `${Math.round(value * 100)}%`; }
