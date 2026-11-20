"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, Lightbulb, MessageCircle, Mic, Search, ShieldCheck, Tags, Trash2, TrendingUp, UsersRound } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { displayIdentity, formatDate, initials, whatsappLink } from "@/lib/workspace-ui";
import type { LabelEntry, MessageClass, Workspace, WorkspaceContact } from "@/types/workspace";
import type { Id } from "../../convex/_generated/dataModel";
import { buttonClass, EmptyState, PageHeader, Pill, Segmented } from "./dashboard-ui";
import { ConfirmDialog, LoadingRows, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

const messageLabels: { value: MessageClass; label: string }[] = [
  { value: "buying_signal", label: "Buying signal" }, { value: "inquiry", label: "Inquiry" },
  { value: "payment_related", label: "Payment related" }, { value: "casual_noise", label: "Casual / noise" }, { value: "manual_review", label: "Manual review" },
];

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
  const deleteCustomer = useMutation(api.foundation.deleteCustomer);
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
    {messages === undefined ? <div className={styles.loading} role="status">Loading messages…</div> : messages.length === 0 ? <EmptyState icon={MessageCircle} title="No retained messages" description="Older messages may have been removed under your retention policy." /> : <ol ref={messagesRef} className={styles.messages} aria-label="Message history">{messages.slice().reverse().map((message) => <li key={message.messageId} className={styles.message} data-role={message.role}><p className={styles.messageBubble}>{message.text || `[${message.type} message — view in WhatsApp]`}</p><div className={styles.messageMeta}><span>{message.role === "owner" ? "You" : message.role === "customer" ? contact.name : "System"}</span><span aria-hidden="true">·</span><time dateTime={new Date(message.timestamp).toISOString()}>{formatDate(message.timestamp, workspace.timezone)}</time></div>{message.type === "audio" && <div style={{ marginTop: 5 }}><Pill><Mic size={11} />{message.transcriptionState === "pending" ? "Transcribing voice note" : message.transcriptionState === "completed" ? "Voice note transcribed" : message.transcriptionState === "failed" ? "Transcription needs review" : "Voice note"}</Pill></div>}{message.manualReview && message.transcriptionState !== "pending" && <div style={{ marginTop: 5 }}><Pill>Media or shortened message · review in WhatsApp</Pill></div>}</li>)}</ol>}
    <footer className={styles.conversationFooter}><span>{contact.isGroup ? "Group conversation" : "Latest 100 retained messages"}</span>{whatsapp ? <a href={whatsapp} className={buttonClass.secondary} target="_blank" rel="noopener noreferrer">Open WhatsApp<ExternalLink size={13} /></a> : <span>Open WhatsApp manually</span>}</footer>
    <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => void removeContact()} busy={deleting} title="Delete stored contact data?" description="This removes the stored conversation from Pipelixr and prevents re-import. It does not delete messages from WhatsApp." confirmLabel="Delete contact data" />
  </section>;
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
  const suggestions = useQuery(api.communityEngine.knowledge, { businessId: workspace.businessId });
  if (!insights || suggestions === undefined) return <LoadingRows label="Loading business insights" />;
  const money = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(value);
  return <div className={styles.reviewGrid}><section className={styles.stack}><div className={styles.metrics}>{[{ label: "Open opportunities", value: insights.open }, { label: "Won", value: insights.won }, { label: "Unanswered questions", value: insights.unansweredQuestions }, { label: "Complaints needing care", value: insights.complaints }].map((metric) => <div className={styles.metric} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}</div><section className={styles.card}><div className={styles.sectionHeading}><div><h2>What people are asking for</h2><p>Demand seen across enabled groups and private chats.</p></div><TrendingUp size={18} /></div>{insights.topDemand.length ? <ul className={styles.auditList}>{insights.topDemand.map((item) => <li key={item.topic}><strong>{item.topic}</strong><p>{item.count} relevant {item.count === 1 ? "message" : "messages"}</p></li>)}</ul> : <EmptyState icon={TrendingUp} title="No demand pattern yet" description="Patterns appear as relevant messages are captured." />}</section><section className={styles.card}><div className={styles.sectionHeading}><div><h2>Groups driving results</h2><p>Recorded revenue attributed to the original community source.</p></div><UsersRound size={18} /></div>{insights.topGroups.length ? <ul className={styles.auditList}>{insights.topGroups.map((group) => <li key={group.groupName}><strong>{group.groupName}</strong><p>{group.opportunities} opportunities · {money(group.revenue)} recorded revenue</p></li>)}</ul> : <EmptyState icon={UsersRound} title="No group outcomes yet" description="Mark opportunities won to see which communities contribute revenue." />}</section></section><aside className={styles.stack}><section className={styles.card}><div className={styles.sectionHeading}><div><h2>Recorded revenue</h2><p>Based on outcomes entered by the business.</p></div></div><div className={styles.metrics}><div className={styles.metric}><strong>{money(insights.groupRevenue)}</strong><span>From groups</span></div><div className={styles.metric}><strong>{money(insights.directRevenue)}</strong><span>From private chats</span></div></div></section><KnowledgeReview workspace={workspace} suggestions={suggestions} /></aside></div>;
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
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  return <article className={styles.labelRow}><div className={styles.itemHead}><span className={styles.avatar}>{initials(entry.customerName)}</span><div><strong>{entry.customerName}</strong><p>{entry.humanLabel ? "Previously reviewed" : "Ready to review"}</p></div><Pill>{messageLabels.find((option) => option.value === entry.prediction)?.label} · {percent(entry.confidence)}</Pill></div><blockquote className={styles.quote}>{entry.message || `[${entry.messageType} message — view in WhatsApp]`}</blockquote><form className={styles.inlineForm} onSubmit={async (event) => { event.preventDefault(); if (saving) return; setSaving(true); setFeedback(null); try { await setLabel({ businessId, interactionId: entry.interactionId, label }); setFeedback({ text: "Label saved. Thank you for reviewing." }); } catch { setFeedback({ text: "We couldn't save this label. Please retry.", error: true }); } finally { setSaving(false); } }}><label>Your label<select className={styles.input} value={label} onChange={(event) => setSelectedLabel(event.target.value as MessageClass)} disabled={saving}>{messageLabels.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><button className={buttonClass.primary} disabled={saving}>{saving ? "Saving…" : "Save label"}</button></form><Notice feedback={feedback} /></article>;
}

function percent(value: number) { return `${Math.round(value * 100)}%`; }
