"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight, Check, ChevronDown, Clock3, ListFilter, Menu, MessageCircleMore,
  MessageSquareText, ShieldCheck, Sparkles, Target, TrendingUp,
  UserRoundCheck, UsersRound, X,
} from "lucide-react";
import Brand from "./Brand";
import styles from "./LandingPage.module.css";

const navigation = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#safety", label: "Safety" },
  { href: "#questions", label: "FAQ" },
];

const pricingPlans = [
  {
    name: "Starter",
    description: "For solo sellers building a calmer, more consistent sales process.",
    monthly: 9_900,
    annual: 99_000,
    conversations: "300 AI-assisted customer chats",
    features: ["1 connected WhatsApp number", "AI-assisted reply drafts", "Lead capture, pipeline and revenue reporting", "One-to-one conversations"],
  },
  {
    name: "Growth",
    description: "For busy sellers ready to qualify, reply, and follow up at scale.",
    monthly: 24_900,
    annual: 249_000,
    conversations: "1,500 AI-assisted customer chats",
    features: ["1 connected WhatsApp number", "Automated replies and qualification", "Follow-ups and payment recovery", "Up to 5 enabled groups"],
    featured: true,
  },
  {
    name: "Scale",
    description: "For multi-number businesses that need higher limits and support.",
    monthly: 59_900,
    annual: 599_000,
    conversations: "5,000 AI-assisted customer chats",
    features: ["Up to 3 WhatsApp numbers", "Advanced attribution", "Up to 25 enabled groups", "Assisted onboarding and priority support"],
    custom: true,
  },
];

const outcomes = [
  { icon: Target, title: "Know who is ready to buy", text: "Bring likely buyers to the top instead of rereading every chat to find the serious ones." },
  { icon: MessageSquareText, title: "Reply with the right context", text: "Give Pipelixr your prices, policies, and voice so every eligible answer starts informed." },
  { icon: TrendingUp, title: "Follow the sale through", text: "Keep next steps and seller-recorded outcomes beside the conversation that created them." },
];

const steps = [
  { number: "01", title: "Teach it your business", text: "Add your products, prices, delivery details, policies, and preferred tone. Review the business prompt before it is used." },
  { number: "02", title: "Connect your WhatsApp", text: "Pair an authorized number after reviewing the connection terms. Creating your workspace does not require a connection." },
  { number: "03", title: "Work the right conversations", text: "See buying signals, suggested next steps, and eligible replies—then keep control of where the assistant is allowed to act." },
];

const questions = [
  { question: "Does Pipelixr send messages for me?", answer: "Only after explicit setup. Complete Teach Pipelixr, then separately authorize one-to-one or group replies. Groups stay silent until enabled individually." },
  { question: "How does the WhatsApp connection work?", answer: "You can pair an authorized number using a QR code. The connection uses Evolution Go, an unofficial provider—not the official WhatsApp Business API. WhatsApp may restrict or ban the number. You must review and accept those risks before pairing." },
  { question: "Is Status-to-Cash available at launch?", answer: "No. That feature remains in the product code but is blocked for Launch 1 while the focus is accurate replies to customer messages and explicitly enabled groups." },
  { question: "What does recovered revenue mean here?", answer: "Claimed recovered revenue is based on seller-recorded outcomes and attribution rules. It is kept separate from independently confirmed recovered revenue. Recording an order as paid is not independent payment verification." },
  { question: "Can I control the data in my workspace?", answer: "Your workspace shows its message-retention period and privacy controls. You can request deletion of a contact and related workspace records from the Inbox, then track the background deletion job in Settings. This does not delete messages from WhatsApp." },
];

const salesScenarios = [
  {
    name: "Amara",
    initials: "AO",
    buyer: "Hi, is the green two-piece still available in Medium? I need it in Abuja before Friday.",
    signal: "Buyer detected",
    insight: "High intent · Medium · Abuja delivery",
    reply: "Yes, Medium is in stock. It’s ₦42,000 and we can dispatch to Abuja within 24 hours. Would you like me to reserve it?",
    followUp: "Tomorrow at 10:00 AM",
  },
  {
    name: "Tobi",
    initials: "TA",
    buyer: "Do you offer a discount if I take 20 pieces? I can make payment today.",
    signal: "Bulk buyer qualified",
    insight: "20 units · Payment ready · Wholesale",
    reply: "Yes. Your 20-piece wholesale price is ₦8,500 each. I can prepare the order summary and payment details now.",
    followUp: "Quote check-in in 2 hours",
  },
  {
    name: "Chidinma",
    initials: "CN",
    buyer: "I’ve sent the transfer receipt. Can you confirm it and deliver to Lekki today?",
    signal: "Receipt detected",
    insight: "Payment verification needed · Lekki",
    reply: "Thanks — I’ve received your receipt and flagged it for verification. I’ll confirm delivery as soon as the payment is verified.",
    followUp: "Verification reminder in 30 minutes",
  },
  {
    name: "Seyi",
    initials: "SO",
    buyer: "How much delivery go Ibadan? I wan order two today.",
    signal: "Buyer detected",
    insight: "2 items · Ibadan · Ready today",
    reply: "Delivery to Ibadan is ₦3,500. I can reserve two for you now and send the payment details. Which colours would you like?",
    followUp: "Follow-up this afternoon",
  },
] as const;

type DemoStage = "buyerTyping" | "analyzing" | "signal" | "replyTyping" | "followUp" | "transition";

const demoStageOrder: Record<DemoStage, number> = {
  buyerTyping: 0,
  analyzing: 1,
  signal: 2,
  replyTyping: 3,
  followUp: 4,
  transition: 5,
};

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  return (
    <div className={styles.page}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.navbar}>
          <Link href="/" aria-label="Pipelixr home" className={styles.brandLink}><Brand /></Link>
          <nav className={styles.desktopNav} aria-label="Main navigation">
            {navigation.map((entry) => <a href={entry.href} key={entry.href}>{entry.label}</a>)}
          </nav>
          <div className={styles.navActions}>
            <Link href="/login" className={styles.signIn}>Sign in</Link>
            <Link href="/signup" className={`${styles.primaryButton} ${styles.navCta}`}>Start selling smarter<ArrowRight size={15} aria-hidden="true" /></Link>
            <button ref={menuButton} type="button" className={styles.menuButton} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="landing-navigation" onClick={() => setMenuOpen((current) => !current)}>
              {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <nav id="landing-navigation" className={styles.mobileNav} aria-label="Mobile navigation" hidden={!menuOpen}>
          {navigation.map((entry) => <a key={entry.href} href={entry.href} onClick={() => setMenuOpen(false)}>{entry.label}<ArrowRight size={15} aria-hidden="true" /></a>)}
          <Link href="/signup" onClick={() => setMenuOpen(false)}>Create your workspace<ArrowRight size={15} aria-hidden="true" /></Link>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <span className={styles.kicker}><span className={styles.kickerIcon}><WhatsAppIcon /></span>Your WhatsApp sales AI agent</span>
            <h1 id="hero-title">Turn busy WhatsApp chats <span>into sales.</span></h1>
            <p className={styles.heroLead}>Pipelixr finds serious buyers in your WhatsApp conversations, qualifies leads, replies using your business details, follows up on opportunities, and tracks which conversations turn into sales.</p>
            <div className={styles.heroActions}>
              <Link href="/signup" className={`${styles.primaryButton} ${styles.heroPrimary}`}>Create my workspace<ArrowRight size={17} aria-hidden="true" /></Link>
              <a href="#product" className={styles.secondaryButton}>See how it works</a>
            </div>
            <ul className={styles.heroTrust} aria-label="Pipelixr product assurances">
              <li><Check size={14} aria-hidden="true" /> Uses your business details</li>
              <li><ShieldCheck size={14} aria-hidden="true" /> Seller-controlled automation</li>
            </ul>
          </div>
          <figure className={styles.heroVisual}>
            <LiveAgentDemo />
          </figure>
        </section>

        <section className={styles.signalStrip} aria-label="Pipelixr product summary">
          <p>One calm workspace for the conversations that can move your business forward.</p>
          <div>
            <span><MessageCircleMore size={17} aria-hidden="true" /> Buying signals</span>
            <span><Sparkles size={17} aria-hidden="true" /> Context-aware replies</span>
            <span><ListFilter size={17} aria-hidden="true" /> Clear next steps</span>
          </div>
        </section>

        <section id="product" className={styles.problemSection} aria-labelledby="problem-title">
          <div className={styles.sectionHeading}>
            <span className={styles.overline}>More signal. Less chat archaeology.</span>
            <h2 id="problem-title">Your next sale may already be waiting in your inbox.</h2>
            <p>When every conversation looks equally urgent, strong buying intent gets buried. Pipelixr turns message activity into a focused list of people and actions worth your attention.</p>
          </div>
          <div className={styles.outcomeGrid}>
            {outcomes.map(({ icon: Icon, title, text }, index) => (
              <article className={styles.outcomeCard} key={title}>
                <span className={styles.cardNumber}>0{index + 1}</span><span className={styles.iconBox}><Icon size={22} strokeWidth={1.8} aria-hidden="true" /></span>
                <h3>{title}</h3><p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.focusSection} aria-labelledby="focus-title">
          <div className={styles.focusVisual}>
            <ConversationCard />
            <div className={styles.focusBadge}><span><Sparkles size={15} aria-hidden="true" /></span><div><strong>Buying intent found</strong><small>Ready for your next step</small></div></div>
          </div>
          <div className={styles.focusCopy}>
            <span className={styles.overline}>Know where to start</span>
            <h2 id="focus-title">Open your workspace. See what needs you.</h2>
            <p>Pipelixr organizes conversations around action—not noise. See who asked about price, who went quiet, and what your business should do next.</p>
            <ul>
              <li><Check size={16} aria-hidden="true" /><span><strong>Priority conversations</strong> surface likely buying intent.</span></li>
              <li><Check size={16} aria-hidden="true" /><span><strong>Business-aware context</strong> keeps replies accurate.</span></li>
              <li><Check size={16} aria-hidden="true" /><span><strong>Seller-recorded outcomes</strong> keep claims honest and traceable.</span></li>
            </ul>
            <Link href="/signup" className={styles.inlineLink}>Build my workspace <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <section id="how-it-works" className={styles.processSection} aria-labelledby="process-title">
          <div className={styles.processHeader}>
            <div><span className={styles.overline}>From setup to signal</span><h2 id="process-title">Useful in three clear steps.</h2></div>
            <p>Set the context once. Keep control of the connection. Spend your attention on the conversations most likely to matter.</p>
          </div>
          <ol className={styles.steps}>
            {steps.map((step) => <li key={step.number}><span className={styles.stepNumber}>{step.number}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}
          </ol>
        </section>

        <section id="pricing" className={styles.pricingSection} aria-labelledby="pricing-title">
          <div className={styles.pricingHeader}>
            <div>
              <span className={styles.overline}>Simple, naira-first pricing</span>
              <h2 id="pricing-title">Start small. Upgrade when the chats demand it.</h2>
              <p>Every new workspace starts with a 14-day Growth trial, including up to 100 AI-assisted customer chats.</p>
            </div>
            <div className={styles.billingToggle} role="group" aria-label="Billing interval">
              <button type="button" aria-pressed={billingInterval === "monthly"} onClick={() => setBillingInterval("monthly")}>Monthly</button>
              <button type="button" aria-pressed={billingInterval === "annual"} onClick={() => setBillingInterval("annual")}>Annual <span>2 months free</span></button>
            </div>
          </div>
          <div className={styles.pricingGrid}>
            {pricingPlans.map((plan) => {
              const amount = billingInterval === "monthly" ? plan.monthly : plan.annual;
              return (
                <article className={`${styles.pricingCard} ${plan.featured ? styles.featuredPlan : ""}`} key={plan.name}>
                  {plan.featured && <span className={styles.popularLabel}>Most popular</span>}
                  <div className={styles.planTop}><h3>{plan.name}</h3>{plan.custom && <span className={styles.customLabel}>For teams</span>}</div>
                  <p className={styles.planDescription}>{plan.description}</p>
                  <div className={styles.price}>
                    {plan.custom && <small>From</small>}
                    <strong>{formatNaira(amount)}</strong>
                    <span>/{billingInterval === "monthly" ? "month" : "year"}</span>
                  </div>
                  {billingInterval === "annual" && <p className={styles.annualNote}>{formatNaira(Math.round(plan.annual / 12))} effective monthly · billed yearly</p>}
                  <div className={styles.planDivider} />
                  <strong className={styles.planAllowance}>{plan.conversations}</strong>
                  <ul className={styles.planFeatures}>
                    {plan.features.map((feature) => <li key={feature}><Check size={15} aria-hidden="true" />{feature}</li>)}
                  </ul>
                  {plan.custom ? (
                    <a className={styles.planButton} href="mailto:sales@pipelixr.com?subject=Pipelixr%20Scale">Contact sales <ArrowRight size={15} aria-hidden="true" /></a>
                  ) : (
                    <Link className={`${styles.planButton} ${plan.featured ? styles.planButtonFeatured : ""}`} href="/signup">Start 14-day trial <ArrowRight size={15} aria-hidden="true" /></Link>
                  )}
                </article>
              );
            })}
          </div>
          <p className={styles.pricingFootnote}>All prices are in Nigerian naira. Payments are processed securely by Paystack. Trial access is bounded by time and usage.</p>
        </section>

        <section id="safety" className={styles.controlSection} aria-labelledby="control-title">
          <div className={styles.controlCopy}>
            <span className={styles.darkOverline}>Control is a product feature</span>
            <h2 id="control-title">Helpful automation should never feel mysterious.</h2>
            <p>Pipelixr stays quiet until you provide business context and choose where replies are allowed. One-to-one chats and every group have separate controls.</p>
            <Link href="/signup" className={styles.lightButton}>Start with a workspace <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
          <div className={styles.controlPanel}>
            <div className={styles.controlPanelHeader}><div><ShieldCheck size={19} aria-hidden="true" /><strong>Reply controls</strong></div><span>Protected</span></div>
            <ControlRow icon={UserRoundCheck} title="One-to-one customers" note="Requires separate authorization" enabled />
            <ControlRow icon={UsersRound} title="Customer community" note="Enabled individually" enabled />
            <ControlRow icon={UsersRound} title="Wholesale network" note="Silent by default" />
            <p><ShieldCheck size={14} aria-hidden="true" /> You control customer authorization and every enabled group.</p>
          </div>
        </section>

        <section id="questions" className={styles.faqSection} aria-labelledby="faq-title">
          <div className={styles.faqIntro}><span className={styles.overline}>Straight answers</span><h2 id="faq-title">Know what you’re connecting.</h2><p>Clear limits build better tools—and better decisions.</p></div>
          <div className={styles.questions}>
            {questions.map((entry) => <details key={entry.question}><summary>{entry.question}<span><ChevronDown size={17} aria-hidden="true" /></span></summary><p>{entry.answer}</p></details>)}
          </div>
        </section>

        <aside id="privacy" className={styles.connectionNote}>
          <ShieldCheck size={21} strokeWidth={1.8} aria-hidden="true" />
          <div><h2>Connection health and control</h2><p>Create a workspace before connecting WhatsApp. Pair only a number you are authorized to manage; full provider and retention terms are shown once at connection and require explicit consent.</p></div>
        </aside>

        <section className={styles.finalCta} aria-labelledby="start-title">
          <div className={styles.finalCtaGlow} aria-hidden="true" />
          <div><span className={styles.finalEyebrow}>Your inbox is already busy</span><h2 id="start-title">Make every promising conversation easier to act on.</h2><p>Create your Pipelixr workspace first. Connect WhatsApp only when you are ready.</p></div>
          <Link href="/signup" className={styles.finalButton}>Create my workspace <ArrowRight size={17} aria-hidden="true" /></Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link href="/" aria-label="Pipelixr home"><Brand /></Link><p>Built for the business happening in your chats.</p>
        <nav aria-label="Footer navigation"><a href="#privacy">Connection & privacy</a><Link href="/login">Sign in</Link></nav>
        <small>© {new Date().getFullYear()} Pipelixr</small>
      </footer>
    </div>
  );
}

function formatNaira(amount: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
}

function ControlRow({ icon: Icon, title, note, enabled = false }: { icon: typeof UsersRound; title: string; note: string; enabled?: boolean }) {
  return <div className={styles.controlRow}><span><Icon size={18} aria-hidden="true" /></span><div><strong>{title}</strong><small>{note}</small></div><span className={`${styles.toggle} ${enabled ? "" : styles.toggleOff}`} aria-label={enabled ? "Enabled" : "Disabled"}><i /></span></div>;
}

function LiveAgentDemo() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [stage, setStage] = useState<DemoStage>("buyerTyping");
  const [buyerLength, setBuyerLength] = useState(0);
  const [replyLength, setReplyLength] = useState(0);
  const [started, setStarted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const scenario = salesScenarios[scenarioIndex];

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReducedMotion(media.matches);
    updateMotionPreference();
    media.addEventListener?.("change", updateMotionPreference);
    const startTimer = window.setTimeout(() => setStarted(true), 900);
    return () => {
      window.clearTimeout(startTimer);
      media.removeEventListener?.("change", updateMotionPreference);
    };
  }, []);

  useEffect(() => {
    if (!started || reducedMotion) return;
    let timer: number;

    if (stage === "buyerTyping") {
      if (buyerLength < scenario.buyer.length) {
        timer = window.setTimeout(() => setBuyerLength((length) => length + 1), typingDelay(scenario.buyer, buyerLength));
      } else {
        timer = window.setTimeout(() => setStage("analyzing"), 650);
      }
    } else if (stage === "analyzing") {
      timer = window.setTimeout(() => setStage("signal"), 1350);
    } else if (stage === "signal") {
      timer = window.setTimeout(() => setStage("replyTyping"), 950);
    } else if (stage === "replyTyping") {
      if (replyLength < scenario.reply.length) {
        timer = window.setTimeout(() => setReplyLength((length) => length + 1), typingDelay(scenario.reply, replyLength));
      } else {
        timer = window.setTimeout(() => setStage("followUp"), 700);
      }
    } else if (stage === "followUp") {
      timer = window.setTimeout(() => setStage("transition"), 2600);
    } else {
      timer = window.setTimeout(() => {
        setScenarioIndex((index) => (index + 1) % salesScenarios.length);
        setBuyerLength(0);
        setReplyLength(0);
        setStage("buyerTyping");
      }, 650);
    }

    return () => window.clearTimeout(timer);
  }, [buyerLength, reducedMotion, replyLength, scenario, stage, started]);

  const complete = !started || reducedMotion;
  const currentStage = complete ? demoStageOrder.followUp : demoStageOrder[stage];
  const buyerText = complete ? scenario.buyer : scenario.buyer.slice(0, buyerLength);
  const replyText = complete ? scenario.reply : scenario.reply.slice(0, replyLength);
  const isLeaving = !complete && stage === "transition";
  const announcement = complete
    ? `${scenario.signal}. Reply ready. Follow-up scheduled.`
    : stage === "analyzing"
      ? "Pipelixr is analysing the conversation."
      : stage === "signal"
        ? `${scenario.signal}. ${scenario.insight}`
        : stage === "replyTyping"
          ? "Pipelixr is preparing a reply using the business details."
          : stage === "followUp"
            ? `Reply ready. Follow-up scheduled for ${scenario.followUp}.`
            : `${scenario.name} is typing a WhatsApp message.`;

  return (
    <div className={`${styles.agentDemo} ${isLeaving ? styles.agentDemoLeaving : ""}`} data-live-agent-demo="true" role="img" aria-label="Pipelixr handling changing WhatsApp sales conversations in real time">
      <div className={styles.agentDemoBackdrop} aria-hidden="true" />
      <div className={styles.agentArtwork} aria-hidden="true">
        <Image src="/pipelixr-agent-hero.webp" width={612} height={408} priority sizes="(max-width: 900px) 92vw, 48vw" alt="" />
      </div>

      <div className={styles.liveConversation} aria-hidden="true">
        <div className={`${styles.liveBubble} ${styles.buyerBubble}`}>
          <div className={styles.liveBubbleHeader}><span>{scenario.initials}</span><div><strong>{scenario.name}</strong><small>WhatsApp · now</small></div></div>
          <p>{buyerText}{!complete && stage === "buyerTyping" && <TypingCursor />}</p>
        </div>

        {currentStage >= demoStageOrder.analyzing && (
          <div className={`${styles.liveBubble} ${styles.signalBubble} ${stage === "analyzing" && !complete ? styles.isAnalyzing : ""}`}>
            <span className={styles.signalIcon}><Sparkles size={14} aria-hidden="true" /></span>
            <div>
              <strong>{stage === "analyzing" && !complete ? "Understanding buying intent" : scenario.signal}</strong>
              <small>{stage === "analyzing" && !complete ? <TypingDots /> : scenario.insight}</small>
            </div>
          </div>
        )}

        {currentStage >= demoStageOrder.replyTyping && (
          <div className={`${styles.liveBubble} ${styles.replyBubble}`}>
            <div className={styles.replyLabel}><span><Brand compact /></span><strong>Pipelixr</strong><small>{stage === "replyTyping" && replyLength < scenario.reply.length && !complete ? "typing" : "reply ready"}</small></div>
            <p>{replyText}{!complete && stage === "replyTyping" && replyLength < scenario.reply.length && <TypingCursor />}</p>
            <span className={styles.replyContext}><Check size={11} aria-hidden="true" /> Uses your business details</span>
          </div>
        )}

        {currentStage >= demoStageOrder.followUp && (
          <div className={`${styles.liveBubble} ${styles.followUpBubble}`}>
            <span><Clock3 size={16} aria-hidden="true" /></span><div><strong>Follow-up scheduled</strong><small>{scenario.followUp}</small></div><Check size={14} aria-hidden="true" />
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
}

function TypingCursor() {
  return <span className={styles.typingCursor} aria-hidden="true" />;
}

function TypingDots() {
  return <span className={styles.typingDots} aria-label="Typing"><i /><i /><i /></span>;
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M12 2a9.6 9.6 0 0 0-8.3 14.4L2.4 21.6l5.3-1.3A9.6 9.6 0 1 0 12 2Zm0 2a7.6 7.6 0 1 1-3.9 14.1l-.4-.2-2.4.6.6-2.3-.3-.4A7.6 7.6 0 0 1 12 4Zm-3.1 3.7c-.2 0-.5.1-.7.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.4 2 .8 2.4.6 2.8.6.5 0 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1-.1-.1-.3-.2-.6-.4l-1.7-.8c-.2-.1-.4-.1-.6.2l-.8 1c-.1.2-.3.2-.5.1a6.2 6.2 0 0 1-1.9-1.2 7 7 0 0 1-1.3-1.7c-.1-.2 0-.4.1-.5l.4-.5.2-.4c.1-.2 0-.4 0-.5l-.8-1.8c-.2-.4-.4-.4-.6-.4h-.4Z" />
    </svg>
  );
}

function typingDelay(text: string, index: number) {
  const character = text[index] ?? "";
  if (/[.!?]/.test(character)) return 130;
  if (/[,—]/.test(character)) return 85;
  if (character === " ") return 22;
  return 28 + (index % 4) * 7;
}

function ConversationCard() {
  return (
    <div className={styles.conversationCard} aria-label="Sample customer conversation and suggested action">
      <div className={styles.conversationHeader}><div><span className={`${styles.contactAvatar} ${styles.avatarGold}`}>AM</span><div><strong>Amara Okafor</strong><small>WhatsApp · 12 minutes ago</small></div></div><span className={styles.intentBadge}>High intent</span></div>
      <div className={styles.messages}><div className={styles.incomingMessage}>Hi, I saw the brown linen set. Is medium still available?</div><div className={styles.outgoingMessage}>Yes, it is available. Delivery within Lagos takes 1–2 business days.</div><div className={styles.incomingMessage}>Great. How do I pay?</div></div>
      <div className={styles.nextAction}><span><Target size={16} aria-hidden="true" /></span><div><small>Suggested next step</small><strong>Send payment details and record the order</strong></div><ArrowRight size={16} aria-hidden="true" /></div>
    </div>
  );
}
