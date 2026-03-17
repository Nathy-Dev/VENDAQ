"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import {
  MessageSquare,
  Users,
  Zap,
  BarChart3,
  Clock,
  ArrowRight,
  Check,
  XCircle,
  CheckCircle2,
  Smartphone,
  ShoppingBag,

  RefreshCcw,
  TrendingUp,
  Bot,
  Shirt,

  Car,
  Building2,
  WifiOff,
  Menu,
  X,
  Sparkles,
  Play,
  Eye,
} from "lucide-react";
import styles from "./LandingPage.module.css";

/* ================================================================
   DATA
   ================================================================ */

const problemSteps = [
  {
    num: 1,
    title: "Customer Messages You",
    desc: "A new inquiry lands in your personal WhatsApp chat.",
    icon: MessageSquare,
  },
  {
    num: 2,
    title: "You Reply Manually",
    desc: "You type back between 20 other conversations.",
    icon: Smartphone,
  },
  {
    num: 3,
    title: "Chat Gets Buried",
    desc: "Within hours, the conversation is lost under new messages.",
    icon: Eye,
  },
  {
    num: 4,
    title: "Customer Disappears",
    desc: "No follow-up, no reminder. The lead goes cold.",
    icon: XCircle,
  },
  {
    num: 5,
    title: "You Forget Completely",
    desc: 'Weeks later: "Wait, who asked about that product?"',
    icon: Clock,
  },
  {
    num: 6,
    title: "Sale Is Lost Forever",
    desc: "Revenue walks out the door. Every. Single. Day.",
    icon: TrendingUp,
  },
];

const solutionSteps = [
  {
    num: 1,
    title: "Customer Sends Message",
    desc: "Same WhatsApp they already use. Zero friction.",
    icon: MessageSquare,
  },
  {
    num: 2,
    title: "Auto Lead Created",
    desc: "VENDAQ instantly captures name, phone, and interest.",
    icon: Users,
  },
  {
    num: 3,
    title: "AI Extracts Intent",
    desc: '"Laptop repair inquiry" — tagged and categorized automatically.',
    icon: Sparkles,
  },
  {
    num: 4,
    title: "Pipeline Updated",
    desc: "Customer appears in your visual sales pipeline instantly.",
    icon: BarChart3,
  },
  {
    num: 5,
    title: "Smart Follow-Up",
    desc: "Gone quiet? Automated reminder sent at the perfect time.",
    icon: RefreshCcw,
  },
  {
    num: 6,
    title: "Sale Converted & Tracked",
    desc: "Payment link sent, revenue logged, inventory updated.",
    icon: CheckCircle2,
  },
];

const features = [
  {
    title: "Auto Customer Capture",
    desc: "Every WhatsApp message becomes a complete customer profile — name, phone, product interest, chat history. Zero manual entry.",
    icon: Users,
    color: "#10b981",
  },
  {
    title: "Conversation Pipeline",
    desc: "See every deal at a glance: New Inquiry → Negotiation → Payment Pending → Completed Sale. Not buried chats.",
    icon: BarChart3,
    color: "#3b82f6",
  },
  {
    title: "Follow-Up Automation",
    desc: "Customer went silent? VENDAQ sends the perfect nudge at the right time. Recover revenue you never knew you were losing.",
    icon: Clock,
    color: "#f59e0b",
  },
  {
    title: "Sales Analytics",
    desc: "Total revenue, pending payments, top customers, best-selling products. Visibility most small businesses never have.",
    icon: TrendingUp,
    color: "#8b5cf6",
  },
  {
    title: "AI Sales Assistant",
    desc: "Suggests replies, detects customer intent, recommends next actions. Speed up responses without sounding robotic.",
    icon: Bot,
    color: "#06b6d4",
  },
  {
    title: "Offline-Resilient Sync",
    desc: "Network drops? VENDAQ queues every action and syncs the moment you reconnect. Nothing is ever lost.",
    icon: WifiOff,
    color: "#ec4899",
  },
];

const howItWorks = [
  {
    num: 1,
    title: "Connect WhatsApp",
    desc: "Scan a QR code or paste your API token. Your existing WhatsApp — no new number needed.",
  },
  {
    num: 2,
    title: "AI Auto-Organizes",
    desc: "VENDAQ reads your incoming chats, creates leads, tags intent, and builds your sales pipeline automatically.",
  },
  {
    num: 3,
    title: "You Close Deals",
    desc: "Focus on selling, not data entry. See your pipeline, follow up with one tap, and get paid via Paystack.",
  },
];

const industries = [
  {
    name: "Fashion Vendors",
    use: "Order tracking, size selection, delivery status",
    icon: Shirt,
    color: "#ec4899",
  },
  {
    name: "Phone & Electronics",
    use: "Device tracking, repair status, notifications",
    icon: Smartphone,
    color: "#3b82f6",
  },
  {
    name: "Food Vendors",
    use: "Menu orders, delivery scheduling, repeat customers",
    icon: ShoppingBag,
    color: "#f59e0b",
  },
  {
    name: "Auto Parts",
    use: "Inventory lookup, parts matching, price quotes",
    icon: Car,
    color: "#10b981",
  },
  {
    name: "Real Estate",
    use: "Property inquiries, viewing schedules, follow-ups",
    icon: Building2,
    color: "#8b5cf6",
  },
];

const stats = [
  { value: "80%+", label: "of Nigerian SMEs run sales on WhatsApp", color: "#10b981" },
  { value: "₦Billions", label: "lost weekly to disorganized WhatsApp chats", color: "#f59e0b" },
  { value: "3x", label: "more revenue recovered with automated follow-ups", color: "#3b82f6" },
];

const pipelineData = [
  {
    name: "New",
    count: 3,
    color: "#3b82f6",
    cards: [
      { name: "Chioma A.", detail: "Laptop Repair", price: "₦15,000" },
      { name: "Grace N.", detail: "Screen Guard", price: "₦3,000" },
      { name: "Michael T.", detail: "Charger", price: "₦2,500" },
    ],
  },
  {
    name: "Chatting",
    count: 2,
    color: "#f59e0b",
    cards: [
      { name: "Emeka O.", detail: "iPhone Case", price: "₦5,500" },
      { name: "Linda K.", detail: "AirPods Pro", price: "₦45,000" },
    ],
  },
  {
    name: "Payment",
    count: 1,
    color: "#8b5cf6",
    cards: [{ name: "James B.", detail: "Battery", price: "₦8,000" }],
  },
  {
    name: "Done",
    count: 2,
    color: "#10b981",
    cards: [
      { name: "Sarah M.", detail: "USB Cable", price: "₦1,500" },
      { name: "David E.", detail: "Power Bank", price: "₦12,000" },
    ],
  },
];

/* ================================================================
   ANIMATION VARIANTS
   ================================================================ */

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: "easeOut" as const },
  }),
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.6 } },
};

/* ================================================================
   COMPONENT
   ================================================================ */

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={styles.landingPage}>
      {/* ===== NAVBAR ===== */}
      <nav className={styles.nav}>
        <div className={`${styles.container} ${styles.navInner}`}>
          <Link href="/" className={styles.logo}>
            <Image 
              src="/logo.png" 
              alt="VENDAQ Logo" 
              width={40} 
              height={40} 
              className={styles.logoImg}
            />
            <span>
              VEND<span className={styles.logoAccent}>AQ</span>
            </span>
          </Link>

          <ul className={styles.navLinks}>
            <li><a href="#features">Features</a></li>
            <li><a href="#how-it-works">How It Works</a></li>
            <li><a href="#pricing">Pricing</a></li>
          </ul>

          <Link href="/signup" className={styles.navCta}>
            Get Started <ArrowRight size={16} />
          </Link>

          <button
            className={styles.mobileMenuBtn}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        <div className={`${styles.mobileMenu} ${menuOpen ? styles.mobileMenuOpen : ""}`}>
          <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
          <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How It Works</a>
          <a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
          <Link href="/signup" className={styles.ctaPrimary} onClick={() => setMenuOpen(false)}>
            Get Started <ArrowRight size={16} />
          </Link>
        </div>
      </nav>

      {/* ===== HERO ===== */}
      <section className={styles.hero}>
        <div className={styles.heroGlow1} />
        <div className={styles.heroGlow2} />
        <div className={styles.heroGlow3} />

        <div className={`${styles.container} ${styles.heroContent}`}>
          <motion.div
            className={styles.badge}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Zap size={14} /> WhatsApp-First Business Automation
          </motion.div>

          <motion.h1
            className={styles.heroTitle}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            Stop Losing Sales in{" "}
            <span className={styles.heroTitleGradient}>WhatsApp Chaos</span>
          </motion.h1>

          <motion.p
            className={styles.heroSub}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            VENDAQ turns your messy WhatsApp chats into a structured sales pipeline.
            Auto-capture leads, track orders, follow up automatically, and get paid —
            all without leaving WhatsApp.
          </motion.p>

          <motion.div
            className={styles.heroCtas}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.45 }}
          >
            <Link href="/signup" className={styles.ctaPrimary}>
              Start Free <ArrowRight size={18} />
            </Link>
            <a href="#how-it-works" className={styles.ctaSecondary}>
              <Play size={16} /> See How It Works
            </a>
          </motion.div>

          {/* Mock Dashboard */}
          <motion.div
            className={styles.mockDashboard}
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6, type: "spring", stiffness: 60 }}
          >
            <div className={styles.mockToolbar}>
              <span className={styles.mockDot} style={{ background: "#ef4444" }} />
              <span className={styles.mockDot} style={{ background: "#f59e0b" }} />
              <span className={styles.mockDot} style={{ background: "#10b981" }} />
              <span className={styles.mockTitle}>VENDAQ — Sales Pipeline</span>
            </div>
            <div className={styles.pipelineGrid}>
              {pipelineData.map((col) => (
                <div key={col.name} className={styles.pipelineCol}>
                  <div className={styles.pipelineColHeader}>
                    <span className={styles.pipelineColName} style={{ color: col.color }}>
                      {col.name}
                    </span>
                    <span className={styles.pipelineColCount}>{col.count}</span>
                  </div>
                  {col.cards.map((card) => (
                    <div key={card.name} className={styles.pipelineCard}>
                      <div className={styles.pipelineCardName}>{card.name}</div>
                      <div className={styles.pipelineCardDetail}>{card.detail}</div>
                      <div className={styles.pipelineCardPrice}>{card.price}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ===== PROBLEM SECTION ===== */}
      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.container}>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeIn}
          >
            <span className={styles.sectionLabel}>The Problem</span>
            <h2 className={styles.sectionTitle}>Your WhatsApp Is Leaking Revenue</h2>
            <p className={styles.sectionSub}>
              This is how most small businesses operate every single day — and it costs
              them thousands in lost sales.
            </p>
          </motion.div>

          <div className={styles.workflowGrid}>
            {problemSteps.map((step, i) => (
              <motion.div
                key={step.num}
                className={styles.workflowCardProblem}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                variants={fadeUp}
              >
                <step.icon size={36} className={styles.workflowIcon} style={{ color: "#ef4444" }} />
                <span className={`${styles.workflowStep} ${styles.stepProblem}`}>{step.num}</span>
                <h3 className={styles.workflowCardTitle}>{step.title}</h3>
                <p className={styles.workflowCardDesc}>{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== SOLUTION SECTION ===== */}
      <section className={styles.section}>
        <div className={styles.container}>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeIn}
          >
            <span className={styles.sectionLabel}>The Solution</span>
            <h2 className={styles.sectionTitle}>VENDAQ Turns Chaos Into Pipeline</h2>
            <p className={styles.sectionSub}>
              Same WhatsApp. Completely different outcome. Every message is
              automatically structured, tracked, and acted on.
            </p>
          </motion.div>

          <div className={styles.workflowGrid}>
            {solutionSteps.map((step, i) => (
              <motion.div
                key={step.num}
                className={styles.workflowCard}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                variants={fadeUp}
              >
                <step.icon size={36} className={styles.workflowIcon} style={{ color: "#10b981" }} />
                <span className={`${styles.workflowStep} ${styles.stepSolution}`}>{step.num}</span>
                <h3 className={styles.workflowCardTitle}>{step.title}</h3>
                <p className={styles.workflowCardDesc}>{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section id="features" className={`${styles.section} ${styles.sectionAlt} ${styles.sectionCenter}`}>
        <div className={styles.container}>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeIn}
          >
            <span className={styles.sectionLabel}>Features</span>
            <h2 className={styles.sectionTitle}>Everything Your Business Needs</h2>
            <p className={styles.sectionSub}>
              Built specifically for the way African small businesses actually sell — on
              WhatsApp, with real conversations.
            </p>
          </motion.div>

          <div className={styles.featureGrid}>
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                className={styles.featureCard}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                variants={fadeUp}
              >
                <div
                  className={styles.featureIcon}
                  style={{ background: `${f.color}18` }}
                >
                  <f.icon size={24} style={{ color: f.color }} />
                </div>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureDesc}>{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section id="how-it-works" className={`${styles.section} ${styles.sectionCenter}`}>
        <div className={styles.container}>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeIn}
          >
            <span className={styles.sectionLabel}>How It Works</span>
            <h2 className={styles.sectionTitle}>Up and Running in 3 Steps</h2>
            <p className={styles.sectionSub}>
              No complicated setup. No learning curve. Connect, and VENDAQ handles the
              rest.
            </p>
          </motion.div>

          <div className={styles.stepsGrid}>
            {howItWorks.map((step, i) => (
              <motion.div
                key={step.num}
                className={styles.stepCard}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                variants={fadeUp}
              >
                <div className={styles.stepNumber}>{step.num}</div>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepDesc}>{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== VERTICALS ===== */}
      <section className={`${styles.section} ${styles.sectionAlt} ${styles.sectionCenter}`}>
        <div className={styles.container}>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeIn}
          >
            <span className={styles.sectionLabel}>Built For You</span>
            <h2 className={styles.sectionTitle}>Built for Your Industry</h2>
            <p className={styles.sectionSub}>
              VENDAQ adapts to the way your specific business works — not the other way
              around.
            </p>
          </motion.div>

          <div className={styles.verticalsGrid}>
            {industries.map((ind, i) => (
              <motion.div
                key={ind.name}
                className={styles.verticalCard}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                variants={fadeUp}
              >
                <div
                  className={styles.verticalIcon}
                  style={{ background: `${ind.color}18` }}
                >
                  <ind.icon size={24} style={{ color: ind.color }} />
                </div>
                <h3 className={styles.verticalName}>{ind.name}</h3>
                <p className={styles.verticalUse}>{ind.use}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== STATS ===== */}
      <section className={`${styles.section} ${styles.sectionCenter}`}>
        <div className={styles.container}>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeIn}
          >
            <span className={styles.sectionLabel}>The Opportunity</span>
            <h2 className={styles.sectionTitle}>The Market Is Massive</h2>
            <p className={styles.sectionSub}>
              WhatsApp is the operating system of African business. VENDAQ is the
              upgrade.
            </p>
          </motion.div>

          <div className={styles.statsGrid}>
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                className={styles.statCard}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-60px" }}
                variants={fadeUp}
              >
                <div className={styles.statNumber} style={{ color: s.color }}>
                  {s.value}
                </div>
                <div className={styles.statLabel}>{s.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PRICING ===== */}
      <section id="pricing" className={`${styles.section} ${styles.sectionAlt} ${styles.sectionCenter}`}>
        <div className={styles.container}>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeIn}
          >
            <span className={styles.sectionLabel}>Pricing</span>
            <h2 className={styles.sectionTitle}>Simple, Transparent Pricing</h2>
            <p className={styles.sectionSub}>
              Start free, upgrade when you are ready. No hidden fees, cancel anytime.
            </p>
          </motion.div>

          <div className={styles.pricingGrid}>
            {/* Starter */}
            <motion.div
              className={styles.pricingCard}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-60px" }}
              variants={fadeUp}
              custom={0}
            >
              <span className={styles.pricingTier}>Starter</span>
              <div className={styles.pricingPrice}>
                Free <span className={styles.pricingPriceSuffix}>forever</span>
              </div>
              <p className={styles.pricingDesc}>Perfect to get started and experience the power of VENDAQ.</p>
              <ul className={styles.pricingFeatures}>
                {[
                  "50 customer profiles",
                  "Basic sales pipeline",
                  "Chat history & search",
                  "Manual follow-up reminders",
                  "WhatsApp connection",
                ].map((f) => (
                  <li key={f} className={styles.pricingFeature}>
                    <Check size={16} style={{ color: "#10b981" }} /> {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className={`${styles.pricingCta} ${styles.pricingCtaSecondary}`}
              >
                Get Started Free
              </Link>
            </motion.div>

            {/* Growth */}
            <motion.div
              className={`${styles.pricingCard} ${styles.pricingHighlight}`}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-60px" }}
              variants={fadeUp}
              custom={1}
            >
              <span className={styles.pricingBadge}>Most Popular</span>
              <span className={styles.pricingTier}>Growth</span>
              <div className={styles.pricingPrice}>
                ₦5,000 <span className={styles.pricingPriceSuffix}>/ month</span>
              </div>
              <p className={styles.pricingDesc}>For serious sellers who want maximum automation and insight.</p>
              <ul className={styles.pricingFeatures}>
                {[
                  "Unlimited customers",
                  "AI-powered follow-ups",
                  "Smart reply suggestions",
                  "Advanced sales analytics",
                  "Paystack payment integration",
                  "Offline-resilient sync",
                  "Priority support",
                ].map((f) => (
                  <li key={f} className={styles.pricingFeature}>
                    <Check size={16} style={{ color: "#10b981" }} /> {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className={`${styles.pricingCta} ${styles.pricingCtaPrimary}`}
              >
                Start 14-Day Free Trial
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ===== CTA BANNER ===== */}
      <section className={styles.ctaBanner}>
        <div className={styles.ctaBannerBg} />
        <div className={styles.container}>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeIn}
          >
            <h2 className={styles.ctaTitle}>Ready to Stop Losing Sales?</h2>
            <p className={styles.ctaSub}>
              Join smart business owners who are turning their WhatsApp into a
              revenue machine.
            </p>
            <Link href="/signup" className={styles.ctaPrimary}>
              Start Free Now <ArrowRight size={18} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerInner}>
            <Link href="/" className={styles.footerLogo}>
              <Image 
                src="/logo.png" 
                alt="VENDAQ Logo" 
                width={32} 
                height={32} 
                className={styles.logoImg}
              />
              <span>
                VEND<span className={styles.logoAccent}>AQ</span>
              </span>
            </Link>
            <ul className={styles.footerLinks}>
              <li><a href="#features">Features</a></li>
              <li><a href="#how-it-works">How It Works</a></li>
              <li><a href="#pricing">Pricing</a></li>
              <li><Link href="/login">Login</Link></li>
              <li><Link href="/signup">Sign Up</Link></li>
            </ul>
          </div>
          <div className={styles.footerBottom}>
            © {new Date().getFullYear()} VENDAQ. All rights reserved. Built for African business.
          </div>
        </div>
      </footer>
    </div>
  );
}
