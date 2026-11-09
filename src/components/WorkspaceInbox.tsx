"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, MessageCircle, Search, ShieldCheck, Tags, Trash2 } from "lucide-react";
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
  const [tab, setTab] = useState<"conversations" | "review">("conversations");
  return (
    <>
      <PageHeader title="Your inbox" description="Real conversations. Clear context. Nothing sent without you." />
      <div className={styles.toolbar}><Segmented label="Inbox view" value={tab} onChange={setTab} options={[{ value: "conversations", label: "Conversations" }, { value: "review", label: "Message review" }]} /><Pill dot>Read-only inbox</Pill></div>
      {tab === "conversations" ? <Suspense fallback={<LoadingRows label="Loading conversations" />}><Conversations workspace={workspace} /></Suspense> : <MessageReview workspace={workspace} />}
    </>
  );
}

function Conversations({ workspace }: { workspace: Workspace }) {
  const contacts = useQuery(api.foundation.customers, { businessId: workspace.businessId });
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Id<"customers"> | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const initialContact = searchParams.get("contact");
  const selectedId = selected === undefined ? contacts?.find((contact) => contact.customerId === initialContact)?.customerId : selected;
  const selectedContact = contacts?.find((contact) => contact.customerId === selectedId);
  const filtered = contacts?.filter((contact) => `${contact.name} ${displayIdentity(contact.identity)}`.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className={styles.inbox} data-selected={Boolean(selectedContact)}>
      <section className={styles.contactPane} aria-label="Conversations">
        <div className={styles.contactPaneHeader}><label className={styles.search}><Search size={16} aria-hidden="true" /><span className="sr-only">Search conversations</span><input type="search" placeholder="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} /></label><p className={styles.helper}>{contacts === undefined ? "Loading…" : `${contacts.length} recent ${contacts.length === 1 ? "conversation" : "conversations"}`}</p></div>
        {contacts === undefined ? <div className={styles.loading} role="status">Loading contacts…</div> : filtered?.length === 0 ? <EmptyState icon={MessageCircle} title={search ? "No matches" : "No conversations yet"} description={search ? "Try a different name or phone number." : "New messages appear after you connect WhatsApp."} /> :
          <ul className={styles.contacts}>{filtered?.map((contact) => <li key={contact.customerId}><button className={styles.contactButton} aria-pressed={selectedId === contact.customerId} onClick={() => setSelected(contact.customerId)}>
            <span className={styles.avatar}>{initials(contact.name)}</span><div><strong>{contact.name}</strong><p>{displayIdentity(contact.identity)}</p></div><time dateTime={new Date(contact.lastActivityAt).toISOString()}>{new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", timeZone: workspace.timezone }).format(contact.lastActivityAt)}</time>
          </button></li>)}</ul>}
      </section>
      {selectedContact ? <Conversation key={selectedContact.customerId} workspace={workspace} contact={selectedContact} onBack={() => setSelected(null)} /> :
        <div className={styles.conversationEmpty}><EmptyState icon={MessageCircle} title="Your conversations, together" description="Select a customer to see your captured message history. Reply in WhatsApp when you're ready." /></div>}
    </div>
  );
}

function Conversation({ workspace, contact, onBack }: { workspace: Workspace; contact: WorkspaceContact; onBack: () => void }) {
  const messages = useQuery(api.foundation.messages, { businessId: workspace.businessId, customerId: contact.customerId });
  const deleteCustomer = useMutation(api.foundation.deleteCustomer);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const messagesRef = useRef<HTMLOListElement>(null);
  const whatsapp = whatsappLink(contact.identity);

  useEffect(() => {
    const list = messagesRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages?.length]);

  async function removeContact() {
    if (deleting) return;
    setDeleting(true); setFeedback(null);
    try { await deleteCustomer({ businessId: workspace.businessId, customerId: contact.customerId }); setConfirmDelete(false); onBack(); }
    catch { setFeedback({ text: "We couldn't request deletion. Please try again.", error: true }); setConfirmDelete(false); }
    finally { setDeleting(false); }
  }

  return (
    <section className={styles.conversation} aria-label={`Conversation with ${contact.name}`}>
      <header className={styles.conversationHeader}>
        <button className={styles.mobileBack} aria-label="Back to conversations" onClick={onBack}><ArrowLeft size={20} /></button><span className={styles.avatar}>{initials(contact.name)}</span><div><strong>{contact.name}</strong><p>{displayIdentity(contact.identity)}</p></div>
        <button className={buttonClass.ghost} aria-label="Delete stored contact data" title="Delete stored contact data" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></button>
      </header>
      <Notice feedback={feedback} />
      {messages === undefined ? <div className={styles.loading} role="status">Loading messages…</div> : messages.length === 0 ? <EmptyState icon={MessageCircle} title="No retained messages" description="Older messages may have been removed under your retention policy." /> :
        <ol ref={messagesRef} className={styles.messages} aria-label="Message history">{messages.slice().reverse().map((message) => <li key={message.messageId} className={styles.message} data-role={message.role}>
          <p className={styles.messageBubble}>{message.text || `[${message.type} message — view in WhatsApp]`}</p>
          <div className={styles.messageMeta}><span>{message.role === "owner" ? "You" : message.role === "customer" ? contact.name : "System"}</span><span aria-hidden="true">·</span><time dateTime={new Date(message.timestamp).toISOString()}>{formatDate(message.timestamp, workspace.timezone)}</time></div>
          {message.manualReview && <div style={{ marginTop: 5 }}><Pill>Media or shortened message · review in WhatsApp</Pill></div>}
        </li>)}</ol>}
      <footer className={styles.conversationFooter}><span>Read-only · latest 100 retained messages</span>{whatsapp ? <a href={whatsapp} className={buttonClass.secondary} target="_blank" rel="noopener noreferrer">Open WhatsApp<ExternalLink size={13} /></a> : <span>Open WhatsApp manually</span>}</footer>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => void removeContact()} busy={deleting} title="Delete stored contact data?" description="This removes the contact and their stored conversations from Pipelixr, and prevents re-import. It does not delete messages from WhatsApp. This can't be undone." confirmLabel="Delete contact data" />
    </section>
  );
}

function MessageReview({ workspace }: { workspace: Workspace }) {
  const queue = useQuery(api.readOnly.labelQueue, { businessId: workspace.businessId });
  const evaluation = useQuery(api.readOnly.evaluation, { businessId: workspace.businessId });
  return (
    <div className={styles.reviewGrid}>
      <section className={styles.stack} aria-label="Messages to review">
        <div className={styles.infoBanner}><Tags size={18} /><span>Help keep message classification accurate. Your labels are used for evaluation only — they never send a message or create an outreach instruction.</span></div>
        {queue === undefined ? <LoadingRows label="Loading message review queue" /> : queue.length === 0 ? <div className={styles.card}><EmptyState icon={Tags} title="Nothing to review yet" description="Customer messages that can be classified appear here after capture." /></div> : queue.map((entry) => <LabelRow key={`${entry.interactionId}:${entry.humanLabel}`} entry={entry} businessId={workspace.businessId} />)}
      </section>
      <aside className={styles.card}>
        <div className={styles.sectionHeading}><div><h2>Classification quality</h2><p>Measured against your labeled sample.</p></div><ShieldCheck size={18} /></div>
        {evaluation ? <><div className={styles.metrics}>{[{ label: "Labeled messages", value: evaluation.samples }, { label: "Precision", value: percent(evaluation.precision) }, { label: "Recall", value: percent(evaluation.recall) }, { label: "F1 score", value: percent(evaluation.f1) }].map((metric) => <div className={styles.metric} key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}</div><p className={styles.helper}>Version {evaluation.version}</p>{evaluation.samples < 20 && <p className={styles.helper} role="status">This sample is still small. These scores are not evidence of real-market accuracy yet.</p>}</> : <div className={styles.loading} role="status">Loading evaluation…</div>}
      </aside>
    </div>
  );
}

function LabelRow({ entry, businessId }: { entry: LabelEntry; businessId: Id<"businesses"> }) {
  const setLabel = useMutation(api.readOnly.setLabel);
  const [label, setSelectedLabel] = useState<MessageClass>(entry.humanLabel ?? entry.prediction);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  return (
    <article className={styles.labelRow}>
      <div className={styles.itemHead}><span className={styles.avatar}>{initials(entry.customerName)}</span><div><strong>{entry.customerName}</strong><p>{entry.humanLabel ? "Previously reviewed" : "Ready to review"}</p></div><Pill>{messageLabels.find((option) => option.value === entry.prediction)?.label} · {percent(entry.confidence)}</Pill></div>
      <blockquote className={styles.quote}>{entry.message || `[${entry.messageType} message — view in WhatsApp]`}</blockquote>
      <form className={styles.inlineForm} onSubmit={async (event) => {
        event.preventDefault(); if (saving) return; setSaving(true); setFeedback(null);
        try { await setLabel({ businessId, interactionId: entry.interactionId, label }); setFeedback({ text: "Label saved. Thank you for reviewing." }); }
        catch { setFeedback({ text: "We couldn't save this label. Please retry.", error: true }); }
        finally { setSaving(false); }
      }}><label>Your label<select className={styles.input} value={label} onChange={(event) => setSelectedLabel(event.target.value as MessageClass)} disabled={saving}>{messageLabels.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><button className={buttonClass.primary} disabled={saving}>{saving ? "Saving…" : "Save label"}</button></form>
      <div style={{ marginTop: feedback ? 12 : 0 }}><Notice feedback={feedback} /></div>
      <details className={styles.details}><summary>Classification evidence</summary><p className={styles.helper}>{entry.classifierVersion} · {entry.ruleIds.join(", ") || "No matching rules"}</p></details>
    </article>
  );
}

function percent(value: number) { return `${Math.round(value * 100)}%`; }
