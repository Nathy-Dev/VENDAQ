"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Home, ListTodo, Menu, MessageCircle, Radio, Search, Settings, ShieldCheck, UserRound, X } from "lucide-react";
import Brand from "./Brand";
import styles from "./LandingPage.module.css";

const navigation = [{ href: "#product", label: "The workspace" }, { href: "#workflow", label: "How it works" }, { href: "#questions", label: "Questions" }];
const features = [
  { icon: MessageCircle, title: "The context, not the clutter.", text: "A quiet inbox keeps eligible conversations and customer details together. Find the chat without losing the thread." },
  { icon: ListTodo, title: "A next step you can actually take.", text: "Review prioritized buying signals and follow-up drafts. Copy the message, open WhatsApp, and send it yourself." },
  { icon: Check, title: "An honest picture of your work.", text: "Record orders and outcomes without confusing seller-entered claims with independently confirmed payments." },
];
const questions = [
  { question: "Does Pipelixr send messages for me?", answer: "No. Follow-ups are drafts for you to review, copy, and send in WhatsApp. Opening your workspace does not send replies, mark messages as read, react, or publish presence. Automated sending remains disabled." },
  { question: "How does the WhatsApp connection work?", answer: "You can pair an authorized number using a QR code. The connection uses Evolution Go, an unofficial provider—not the official WhatsApp Business API. WhatsApp may restrict or ban the number. You must review and accept those risks before pairing." },
  { question: "Are Status viewers turned into leads?", answer: "No. Optional Status observations use private, hashed identity keys. They do not reveal phone numbers, prove unique people, create leads, or trigger outreach." },
  { question: "What does recovered revenue mean here?", answer: "Claimed recovered revenue is based on seller-recorded outcomes and attribution rules. It is kept separate from independently confirmed recovered revenue. Recording an order as paid is not independent payment verification." },
  { question: "Can I control the data in my workspace?", answer: "Your workspace shows its message-retention period and privacy controls. You can request deletion of a contact and related workspace records from the Inbox, then track the background deletion job in Settings. This does not delete messages from WhatsApp." },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); } }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [menuOpen]);

  return (
    <div className={styles.page}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.navbar}>
          <Link href="/" aria-label="Pipelixr home"><Brand /></Link>
          <nav className={styles.desktopNav} aria-label="Main">{navigation.map((entry) => <a href={entry.href} key={entry.href}>{entry.label}</a>)}</nav>
          <div className={styles.navActions}><Link href="/login" className={styles.signIn}>Sign in</Link><Link href="/signup" className={`${styles.primaryButton} ${styles.navCta}`}>Get started<ArrowRight size={14} aria-hidden="true" /></Link><button ref={menuButton} type="button" className={styles.menuButton} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="landing-navigation" onClick={() => setMenuOpen((current) => !current)}>{menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}</button></div>
        </div>
        <nav id="landing-navigation" className={styles.mobileNav} aria-label="Mobile main" hidden={!menuOpen}>{navigation.map((entry) => <a key={entry.href} href={entry.href} onClick={() => setMenuOpen(false)}>{entry.label}<ArrowRight size={14} aria-hidden="true" /></a>)}<Link href="/signup" onClick={() => setMenuOpen(false)}>Create your workspace<ArrowRight size={14} aria-hidden="true" /></Link></nav>
      </header>
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroText}>
            <span className={styles.eyebrow}><span aria-hidden="true" />For the business in your chats</span>
            <h1 id="hero-title">Your chats.<br />A clearer<br />next step.</h1>
            <p>Keep conversations, follow-ups, and orders in one calm workspace. Less chasing details. More following through.</p>
            <div className={styles.heroActions}><Link href="/signup" className={styles.primaryButton}>Create your workspace<ArrowRight size={15} aria-hidden="true" /></Link><a href="#product" className={styles.textButton}>Take a look<ArrowRight size={15} aria-hidden="true" /></a></div>
            <p className={styles.heroNote}><ShieldCheck size={14} aria-hidden="true" />You stay in control of every reply.</p>
          </div>
          <figure className={styles.previewFigure}>
            <WorkspacePreview />
            <figcaption><span>One place. A little more clarity.</span><span>Illustrative preview · sample conversations</span></figcaption>
          </figure>
        </section>
        <section id="product" className={styles.product} aria-labelledby="product-title">
          <div className={styles.sectionIntro}><span className={styles.eyebrow}>Only what matters</span><h2 id="product-title">Space to focus.<br />Tools to follow through.</h2><p>Not another feed of numbers. A simple way to see the conversation, decide what’s next, and keep a useful record.</p></div>
          <div className={styles.features}>{features.map(({ icon: Icon, title, text }) => <article className={styles.feature} key={title}><Icon size={24} strokeWidth={1.6} aria-hidden="true" /><h3>{title}</h3><p>{text}</p></article>)}</div>
        </section>
        <section id="workflow" className={styles.workflow} aria-labelledby="workflow-title">
          <div className={styles.workflowIntro}><span className={styles.eyebrow}>Fits into your day</span><h2 id="workflow-title">The way you sell.<br />Just more organized.</h2><Link href="/signup" className={styles.textButton}>Start with your business<ArrowRight size={15} aria-hidden="true" /></Link></div>
          <ol className={styles.steps}><li><span>01</span><div><h3>Create a space for your business.</h3><p>Sign in, add your business name, and review the optional WhatsApp connection before pairing.</p></div></li><li><span>02</span><div><h3>Find the next conversation.</h3><p>Check your inbox and action queue. Review a draft and send the right reply yourself.</p></div></li><li><span>03</span><div><h3>Close the loop.</h3><p>Record the order or outcome. Keep seller-entered revenue claims separate from payment verification.</p></div></li></ol>
        </section>
        <section id="questions" className={styles.faq} aria-labelledby="faq-title">
          <div><span className={styles.eyebrow}>Before you start</span><h2 id="faq-title">A few things,<br />made clear.</h2><p>No hidden sending. No inflated promises.</p></div>
          <div className={styles.questions}>{questions.map((entry) => <details key={entry.question}><summary>{entry.question}<ChevronDown size={16} aria-hidden="true" /></summary><p>{entry.answer}</p></details>)}</div>
        </section>
        <aside id="privacy" className={styles.connectionNote}><ShieldCheck size={20} strokeWidth={1.7} aria-hidden="true" /><div><h2>A note on connecting WhatsApp</h2><p>Pipelixr uses an unofficial Evolution Go connection. Your number may be restricted or banned. Connect only a number you are authorized to manage, and review retention and processing details before pairing. No connection is required to create your workspace.</p></div></aside>
        <section className={styles.finalCta} aria-labelledby="start-title"><div><span className={styles.eyebrow}>Keep it simple</span><h2 id="start-title">Make room for better work.</h2><p>Your next conversation deserves a clearer next step.</p></div><Link href="/signup" className={styles.primaryButton}>Get started<ArrowRight size={15} aria-hidden="true" /></Link></section>
      </main>
      <footer className={styles.footer}><Link href="/" aria-label="Pipelixr home"><Brand /></Link><p>© {new Date().getFullYear()} Pipelixr</p><nav aria-label="Footer"><a href="#privacy">Connection & privacy</a><Link href="/login">Sign in</Link></nav></footer>
    </div>
  );
}

function WorkspacePreview() {
  return (
    <div className={styles.preview} aria-label="Illustration of the Pipelixr inbox, with sample conversations">
      <div className={styles.previewSidebar} aria-hidden="true"><Brand compact /><Home size={21} strokeWidth={1.6} /><span className={styles.previewActive}><MessageCircle size={21} strokeWidth={1.8} /></span><ListTodo size={21} strokeWidth={1.6} /><Radio size={21} strokeWidth={1.6} /><div className={styles.previewSidebarBottom}><Settings size={21} strokeWidth={1.6} /><UserRound size={21} strokeWidth={1.6} /></div></div>
      <div className={styles.previewContent}>
        <div className={styles.previewHeader}><div><span>Everyday Studio</span><h2>Inbox</h2></div><span className={styles.previewMode}>Read-only</span></div>
        <div className={styles.previewInbox}>
          <div className={styles.previewContacts}>
            <div className={styles.previewSearch}><Search size={13} aria-hidden="true" />Search conversations</div>
            <div className={styles.previewContact} data-active="true"><span className={styles.previewAvatar}>AM</span><div><strong>Amara</strong><p>Is the medium still available?</p></div><span className={styles.previewDot} aria-hidden="true" /></div>
            <div className={styles.previewContact}><span className={styles.previewAvatar}>TO</span><div><strong>Tobi</strong><p>Thank you, received!</p></div></div>
            <div className={styles.previewContact}><span className={styles.previewAvatar}>ZA</span><div><strong>Zara</strong><p>Do you deliver to Abuja?</p></div></div>
            <p className={styles.previewContactNote}>The details stay close.<br />The noise stays out.</p>
          </div>
          <div className={styles.previewConversation}>
            <div className={styles.previewConversationHeader}><span className={styles.previewAvatar}>AM</span><div><strong>Amara</strong><p>Buying signal</p></div></div>
            <div className={styles.previewMessages}><span className={styles.previewDate}>Sample conversation</span><div className={styles.previewBubble}>Hi! I saw the linen set on your Status.</div><div className={`${styles.previewBubble} ${styles.previewOwn}`}>Hi Amara. Happy to help.</div><div className={styles.previewBubble}>Is the medium still available?</div><span className={styles.previewTimestamp}>10:42</span></div>
            <div className={styles.previewDraft}><div><ListTodo size={13} aria-hidden="true" /><strong>Your next step</strong></div><p>Review the inquiry and reply in WhatsApp.</p><span>Draft first. Send yourself.<ArrowRight size={12} aria-hidden="true" /></span></div>
          </div>
        </div>
        <div className={styles.previewFooter}><ShieldCheck size={12} aria-hidden="true" />Viewing a chat doesn’t mark it as read.</div>
      </div>
    </div>
  );
}
