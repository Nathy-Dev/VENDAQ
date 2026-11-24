"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight, Boxes, CakeSlice, Check, ChevronDown, Clock3, House, ListFilter, Menu, MessageCircleMore,
  ShieldCheck, Shirt, Sparkles, Target,
  UserRoundCheck, UsersRound, X,
} from "lucide-react";
import Brand from "./Brand";
import styles from "./LandingPage.module.css";

const navigation = [
  { href: "#product", label: "Product" },
  { href: "#businesses", label: "Who it’s for" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
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

const businessTypes = [
  { icon: Shirt, title: "Fashion, beauty & personal care", text: "Handle questions about sizes, shades, stock, prices, and delivery without losing ready buyers." },
  { icon: CakeSlice, title: "Food, cakes & event vendors", text: "Qualify dates, quantities, locations, and custom requests, then keep each quote moving." },
  { icon: House, title: "Home, gadgets & specialty retail", text: "Answer product questions, compare options, share delivery details, and follow up on purchase intent." },
  { icon: Boxes, title: "Wholesalers & distributors", text: "Capture quantities, qualify bulk orders, prepare the next step, and revisit quotes before they go cold." },
];

const steps = [
  { number: "01", title: "Teach Pipelixr your business", text: "Add your products, prices, delivery details, policies, and preferred tone so replies start with the right context." },
  { number: "02", title: "Connect your WhatsApp", text: "Pair an authorized number after reviewing the connection terms. You can explore your workspace before connecting." },
  { number: "03", title: "Choose how it helps", text: "Start with suggested replies or enable automation for approved chats. Pipelixr surfaces buying signals and keeps the next step visible." },
];

const questions = [
  { question: "What kinds of businesses is Pipelixr best for?", answer: "Pipelixr is built for chat-first businesses that sell through WhatsApp and regularly answer questions about products, prices, availability, quantities, delivery, bookings, or payment. It is especially useful when strong buying intent and follow-ups are getting buried in a busy inbox." },
  { question: "Does Pipelixr send messages for me?", answer: "Only when you choose it. Complete Teach Pipelixr, then separately authorize one-to-one replies or enable individual groups. You can use AI-assisted drafts first, and groups stay silent until enabled individually." },
  { question: "Can it understand Pidgin, voice notes, and images?", answer: "Pipelixr can work with English and Pidgin conversations, transcribe supported voice notes, and analyse supported product images and payment receipts. Unclear, unsupported, or sensitive cases can be held for review instead of forcing a confident reply." },
  { question: "How does the WhatsApp connection work?", answer: "You can pair an authorized number using a QR code. The connection uses Evolution Go, an unofficial provider, not the official WhatsApp Business API. WhatsApp may restrict or ban the number. You must review and accept those risks before pairing." },
  { question: "What counts as an AI-assisted customer chat?", answer: "A customer conversation counts when Pipelixr assists it during your billing period. More messages in that same conversation are not counted again during the same period." },
  { question: "Can I control replies and customer data?", answer: "Yes. You choose where replies are allowed, can pause automation, and can review connection health. Your workspace shows its retention settings and privacy controls, including requests to delete a contact’s related workspace records." },
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
    reply: "Thanks, I’ve received your receipt and flagged it for verification. I’ll confirm delivery as soon as the payment is verified.",
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
            <Link href="/signup" className={`${styles.primaryButton} ${styles.navCta}`}>Start free trial<ArrowRight size={15} aria-hidden="true" /></Link>
            <button ref={menuButton} type="button" className={styles.menuButton} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="landing-navigation" onClick={() => setMenuOpen((current) => !current)}>
              {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <nav id="landing-navigation" className={styles.mobileNav} aria-label="Mobile navigation" hidden={!menuOpen}>
          {navigation.map((entry) => <a key={entry.href} href={entry.href} onClick={() => setMenuOpen(false)}>{entry.label}<ArrowRight size={15} aria-hidden="true" /></a>)}
          <Link href="/signup" onClick={() => setMenuOpen(false)}>Start free trial<ArrowRight size={15} aria-hidden="true" /></Link>
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
              <Link href="/signup" className={`${styles.primaryButton} ${styles.heroPrimary}`}>Start my free trial<ArrowRight size={17} aria-hidden="true" /></Link>
              <a href="#product" className={styles.secondaryButton}>See Pipelixr in action</a>
            </div>
            <ul className={styles.heroTrust} aria-label="Pipelixr product assurances">
              <li><Check size={14} aria-hidden="true" /> 14-day Growth trial</li>
              <li><Check size={14} aria-hidden="true" /> No card required</li>
              <li><ShieldCheck size={14} aria-hidden="true" /> You control automation</li>
            </ul>
          </div>
          <figure className={styles.heroVisual}>
            <LiveAgentDemo />
          </figure>
        </section>

        <section className={styles.signalStrip} aria-label="Pipelixr product summary">
          <p>From first question to recorded sale, keep every promising chat moving.</p>
          <div>
            <span><MessageCircleMore size={17} aria-hidden="true" /> Buying signals</span>
            <span><Sparkles size={17} aria-hidden="true" /> Context-aware replies</span>
            <span><ListFilter size={17} aria-hidden="true" /> Clear next steps</span>
          </div>
        </section>

        <section id="product" className={styles.problemSection} aria-labelledby="problem-title">
          <div className={`${styles.sectionHeading} ${styles.productHeading}`}>
            <span className={styles.overline}>From message to next move</span>
            <h2 id="problem-title">Pipelixr understands the sale hiding inside the chat.</h2>
            <p>A customer does not have to say “I am ready to buy.” Pipelixr reads what they need, checks your business details, prepares a grounded reply, and keeps the next sales action visible.</p>
          </div>

          <div className={styles.productStory} aria-label="Example of Pipelixr turning a WhatsApp enquiry into a sales action">
            <div className={styles.storyStep}>
              <div className={styles.storyStepLabel}><span>01</span><strong>A customer asks</strong></div>
              <div className={styles.customerMoment}>
                <div className={styles.customerIdentity}>
                  <span>AO</span>
                  <div><strong>Amara Okafor</strong><small><WhatsAppIcon /> WhatsApp · now</small></div>
                </div>
                <p>Hi, is the brown linen set available in Medium? I need it delivered to Abuja before Friday.</p>
              </div>
            </div>

            <div className={`${styles.storyStep} ${styles.understandingStep}`}>
              <div className={styles.storyStepLabel}><span>02</span><strong>Pipelixr understands</strong></div>
              <div className={styles.intentSummary}>
                <div className={styles.intentSummaryTop}><span><Sparkles size={15} aria-hidden="true" /></span><div><strong>Serious buying intent</strong><small>Delivery timing matters</small></div></div>
                <dl className={styles.intentDetails}>
                  <div><dt>Product</dt><dd>Brown linen set</dd></div>
                  <div><dt>Size</dt><dd>Medium</dd></div>
                  <div><dt>Location</dt><dd>Abuja</dd></div>
                  <div><dt>Needed</dt><dd>Before Friday</dd></div>
                </dl>
                <div className={styles.contextCheck}>
                  <span>Checks your business details</span>
                  <p><Check size={12} aria-hidden="true" /> Medium in stock</p>
                  <p><Check size={12} aria-hidden="true" /> ₦38,000</p>
                  <p><Check size={12} aria-hidden="true" /> Abuja delivery: 2–3 days</p>
                </div>
              </div>
            </div>

            <div className={`${styles.storyStep} ${styles.actionStep}`}>
              <div className={styles.storyStepLabel}><span>03</span><strong>The sale keeps moving</strong></div>
              <div className={styles.preparedReply}>
                <div className={styles.preparedReplyLabel}><span><Brand compact /></span><strong>Reply prepared</strong><small>Using your details</small></div>
                <p>Yes, the brown linen set is available in Medium for ₦38,000. Abuja delivery takes 2–3 days, so it can arrive before Friday if you order today. Would you like the payment details?</p>
              </div>
              <div className={styles.salesNextMove}>
                <span><Clock3 size={16} aria-hidden="true" /></span>
                <div><small>Next move protected</small><strong>Follow up tomorrow if there is no reply</strong></div>
                <Check size={15} aria-hidden="true" />
              </div>
            </div>
          </div>
          <p className={styles.storyNote}>Illustrative example. You decide whether Pipelixr suggests the reply or sends it in an approved chat.</p>
        </section>

        <section id="businesses" className={styles.businessSection} aria-labelledby="businesses-title">
          <div className={styles.businessHeader}>
            <div>
              <span className={styles.overline}>Built for chat-first selling</span>
              <h2 id="businesses-title">If customers ask, order, and follow up on WhatsApp, Pipelixr is built for you.</h2>
            </div>
            <p>Especially when your team repeats the same answers, promising buyers disappear in the scroll, or no one is sure who needs a follow-up next.</p>
          </div>
          <div className={styles.businessGrid}>
            {businessTypes.map(({ icon: Icon, title, text }) => (
              <article className={styles.businessCard} key={title}>
                <span><Icon size={22} strokeWidth={1.7} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <div className={styles.fitStrip}>
            <strong>A strong fit if:</strong>
            <span><Check size={14} aria-hidden="true" /> WhatsApp is a key sales channel</span>
            <span><Check size={14} aria-hidden="true" /> Customers ask repeat questions</span>
            <span><Check size={14} aria-hidden="true" /> Follow-ups decide whether you close</span>
          </div>
          <p className={styles.fitNote}>Best for businesses already selling in chat, not teams looking for a general customer-support chatbot.</p>
        </section>

        <section className={styles.focusSection} aria-labelledby="focus-title">
          <div className={styles.focusVisual}>
            <ConversationCard />
            <div className={styles.focusBadge}><span><Sparkles size={15} aria-hidden="true" /></span><div><strong>Buying intent found</strong><small>Ready for your next step</small></div></div>
          </div>
          <div className={styles.focusCopy}>
            <span className={styles.overline}>Know what deserves attention</span>
            <h2 id="focus-title">Know who to reply to, and what to do next.</h2>
            <p>Pipelixr organizes conversations around action, not noise. See who is asking to buy, who is waiting for an answer, and which opportunity needs a follow-up.</p>
            <ul>
              <li><Check size={16} aria-hidden="true" /><span><strong>Priority conversations</strong> surface likely buying intent.</span></li>
              <li><Check size={16} aria-hidden="true" /><span><strong>Business-aware context</strong> keeps replies accurate.</span></li>
              <li><Check size={16} aria-hidden="true" /><span><strong>Tracked outcomes</strong> connect conversations to the orders you record.</span></li>
            </ul>
            <Link href="/signup" className={styles.inlineLink}>Start my free trial <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <section id="how-it-works" className={styles.processSection} aria-labelledby="process-title">
          <div className={styles.processHeader}>
            <div><span className={styles.overline}>From setup to selling</span><h2 id="process-title">Give Pipelixr context. Let it help with the follow-through.</h2></div>
            <p>Set up the business details once, choose how the assistant can act, and focus your attention on the conversations most likely to convert.</p>
          </div>
          <ol className={styles.steps}>
            {steps.map((step) => <li key={step.number}><span className={styles.stepNumber}>{step.number}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}
          </ol>
        </section>

        <section id="pricing" className={styles.pricingSection} aria-labelledby="pricing-title">
          <div className={styles.pricingHeader}>
            <div>
              <span className={styles.overline}>Simple, naira-first pricing</span>
              <h2 id="pricing-title">Start with the inbox you have. Scale when the conversations grow.</h2>
              <p>Every new workspace starts with a free 14-day Growth trial, including up to 100 AI-assisted customer conversations. No card is required.</p>
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
                    <Link className={`${styles.planButton} ${plan.featured ? styles.planButtonFeatured : ""}`} href="/signup">Start 14-day free trial <ArrowRight size={15} aria-hidden="true" /></Link>
                  )}
                </article>
              );
            })}
          </div>
          <p className={styles.pricingFootnote}>Allowances reset monthly, including on annual plans. Each customer conversation counts once per billing month when Pipelixr assists it. Prices are in Nigerian naira and payments are processed by Paystack. Paid plans renew until cancelled; see the Billing Terms. Results are not guaranteed.</p>
        </section>

        <section id="safety" className={styles.controlSection} aria-labelledby="control-title">
          <div className={styles.controlCopy}>
            <span className={styles.darkOverline}>Set the boundaries</span>
            <h2 id="control-title">You decide where the AI helps, and where it stays quiet.</h2>
            <p>Start with suggested replies, then enable automation only where you are comfortable. One-to-one chats and each WhatsApp group have separate controls, and connection health is monitored in your workspace.</p>
            <Link href="/signup" className={styles.lightButton}>Start my free trial <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
          <div className={styles.controlPanel}>
            <div className={styles.controlPanelHeader}><div><ShieldCheck size={19} aria-hidden="true" /><strong>Automation controls</strong></div><span>Seller controlled</span></div>
            <ControlRow icon={UserRoundCheck} title="One-to-one customers" note="Requires separate authorization" enabled />
            <ControlRow icon={UsersRound} title="Customer community" note="Enabled individually" enabled />
            <ControlRow icon={UsersRound} title="Wholesale network" note="Silent by default" />
            <p><ShieldCheck size={14} aria-hidden="true" /> You control customer authorization and every enabled group.</p>
          </div>
        </section>

        <section id="questions" className={styles.faqSection} aria-labelledby="faq-title">
          <div className={styles.faqIntro}><span className={styles.overline}>Questions before you start</span><h2 id="faq-title">The practical details, clearly answered.</h2><p>What it is for, how it helps, what counts toward usage, and where you stay in control.</p></div>
          <div className={styles.questions}>
            {questions.map((entry) => <details key={entry.question}><summary>{entry.question}<span><ChevronDown size={17} aria-hidden="true" /></span></summary><p>{entry.answer}</p></details>)}
          </div>
        </section>

        <aside id="privacy" className={styles.connectionNote}>
          <ShieldCheck size={21} strokeWidth={1.8} aria-hidden="true" />
          <div><h2>Connection health is monitored</h2><p>Pipelixr records connection interruptions and uncertain sends so they can be reviewed. Pair only a number you are authorized to manage; full provider and retention terms are shown before connection.</p></div>
        </aside>

        <section className={styles.finalCta} aria-labelledby="start-title">
          <div className={styles.finalCtaGlow} aria-hidden="true" />
          <div><span className={styles.finalEyebrow}>Your buyers are already chatting</span><h2 id="start-title">Give every serious buyer a clear next step.</h2><p>Start free for 14 days. Teach Pipelixr your business, explore the workspace, and connect WhatsApp when you are ready.</p></div>
          <Link href="/signup" className={styles.finalButton}>Start my free trial <ArrowRight size={17} aria-hidden="true" /></Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link href="/" aria-label="Pipelixr home"><Brand /></Link><p>Built for the business happening in your chats.</p>
        <nav aria-label="Footer navigation"><Link href="/legal/terms">Terms</Link><Link href="/legal/privacy">Privacy</Link><Link href="/legal/billing">Billing</Link><Link href="/legal/subprocessors">Subprocessors</Link><Link href="/login">Sign in</Link></nav>
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
  if (character === ",") return 85;
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
