"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Bell, Shield, Building, Moon, ChevronRight, Save, Store, Factory, Zap, Clock, Banknote, MessageSquare, Brain, Eye, CheckCircle2, XCircle, Sparkles, Users, RefreshCw } from "lucide-react";

import { useSession } from "next-auth/react";
import { useQuery, useMutation, useAction } from "convex/react";

import { api } from "../../../convex/_generated/api";
import DashboardNavbar from "@/components/DashboardNavbar";
import styles from "./settings.module.css";

type SettingsItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  right?: string;
};

const SETTINGS_GROUPS: { title: string; items: SettingsItem[] }[] = [
  {
    title: "Account",
    items: [
      { id: "business", label: "Business Profile", icon: <Building size={18} /> },
      // "AI Behavior" — plain-language controls that shape HOW the AI replies
      // (tone, language, work hours, dos & don'ts). Distinct from "AI Models" which
      // is the technical/model status view under Advanced.
      { id: "behavior", label: "AI Behavior", icon: <Sparkles size={18} /> },
      // "Groups & Communities" — opt-in scope for the assistant. AI stays silent
      // in every group by default; owners enable it here per-group.
      { id: "groups", label: "Groups & Communities", icon: <Users size={18} /> },
      { id: "automation", label: "Automation Config", icon: <Zap size={18} /> },
      { id: "notifications", label: "Notifications", icon: <Bell size={18} /> },
      { id: "security", label: "Security", icon: <Shield size={18} /> },
    ]
  },
  {
    title: "Advanced",
    items: [
      // Model status card lives under Advanced to keep the top nav simple for
      // non-technical owners. They don't need to see model names day-to-day.
      { id: "ai", label: "AI Models", icon: <Brain size={18} /> },
    ]
  },
  {
    title: "App",
    items: [
      { id: "theme", label: "Appearance", icon: <Moon size={18} />, right: "Dark" },
    ]
  }
];

// Preset one-liners that show up above the business context box. Owners can
// click one to prefill it — reduces the "empty text box" anxiety for
// non-technical users.
const BUSINESS_CONTEXT_EXAMPLES: string[] = [
  "We sell affordable sneakers and streetwear to young Nigerians, mostly on WhatsApp.",
  "We're a home decor brand. We help customers pick items and confirm delivery in Lagos.",
  "We sell phone accessories. We answer price and stock questions and take orders on WhatsApp.",
  "We run a food business. We take orders and answer menu questions.",
];

function minutesToTimeString(minutes?: number): string {
  if (minutes == null) return "";
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeStringToMinutes(value: string): number | undefined {
  if (!value) return undefined;
  const [h, m] = value.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return undefined;
  return h * 60 + m;
}


export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("business");
  const { data: session } = useSession();
  
  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );
  
  const updateBusiness = useMutation(api.businesses.updateBusinessDetails);

  const [bizName, setBizName] = useState("");
  const [bizIndustry, setBizIndustry] = useState("");
  const [aov, setAov] = useState(15000);
  const [responseWindow, setResponseWindow] = useState(120);
  const [followUpTemplate, setFollowUpTemplate] = useState("Hi [Customer Name], thanks for reaching out. We saw your message and will get back to you shortly. What exactly were you looking for today?");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── AI Behavior state ────────────────────────────────────────────────
  // These control HOW the AI replies. All optional — the AI works fine with
  // defaults, but every owner should set at least the business context so the
  // assistant sounds like their business, not a generic bot.
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [aiTone, setAiTone] = useState<"friendly" | "professional" | "playful">("friendly");
  const [aiLanguageStyle, setAiLanguageStyle] = useState<"english" | "pidgin" | "mixed">("english");
  const [aiBusinessContext, setAiBusinessContext] = useState<string>("");
  const [aiWorkHoursEnabled, setAiWorkHoursEnabled] = useState<boolean>(false);
  const [aiWorkHoursStart, setAiWorkHoursStart] = useState<string>("09:00");
  const [aiWorkHoursEnd, setAiWorkHoursEnd] = useState<string>("21:00");
  const [aiNeverQuotePrice, setAiNeverQuotePrice] = useState<boolean>(false);
  const [aiNeverSendPaymentLink, setAiNeverSendPaymentLink] = useState<boolean>(false);
  const [aiNeverOfferDiscount, setAiNeverOfferDiscount] = useState<boolean>(false);

  // ── Groups tab data ──────────────────────────────────────────────────
  const groups = useQuery(
    api.groups.listGroupsForBusiness,
    business?._id ? { businessId: business._id } : "skip"
  );
  const setGroupEnabled = useMutation(api.groups.setGroupEnabled);
  const setGroupMentionOnly = useMutation(api.groups.setGroupMentionOnly);
  // refreshGroups is an ACTION (it calls Evolution Go), not a mutation.
  // useAction is the correct hook for calling actions from React.
  const refreshGroups = useAction(api.groups.refreshGroups);

  const [groupsFilter, setGroupsFilter] = useState<"managed" | "all">("managed");
  const [isRefreshingGroups, setIsRefreshingGroups] = useState(false);

  // Filter groups: by default show only groups you manage (owner/admin).
  // "All" reveals member-only groups too — useful for community managers who
  // don't formally own the group but want to opt-in.
  const visibleGroups = useMemo(() => {
    if (!groups) return [];
    if (groupsFilter === "managed") {
      return groups.filter((g) => g.role === "owner" || g.role === "admin" || g.isEnabled);
    }
    return groups;
  }, [groups, groupsFilter]);

  useEffect(() => {
    if (business) {
      setBizName(business.name || "");
      setBizIndustry(business.industry || "");
      if (business.averageOrderValue) setAov(business.averageOrderValue);
      if (business.responseWindowMinutes) setResponseWindow(business.responseWindowMinutes);
      if (business.followUpTemplate) setFollowUpTemplate(business.followUpTemplate);

      // Hydrate AI Behavior fields. Defaults kick in if the owner hasn't
      // opened this tab yet — safe for existing customers.
      setAiEnabled(business.aiEnabled ?? true);
      setAiTone((business.aiTone as any) || "friendly");
      setAiLanguageStyle((business.aiLanguageStyle as any) || "english");
      setAiBusinessContext(business.aiBusinessContext || "");
      setAiWorkHoursEnabled(business.aiWorkHoursEnabled ?? false);
      if (business.aiWorkHoursStart != null) setAiWorkHoursStart(minutesToTimeString(business.aiWorkHoursStart));
      if (business.aiWorkHoursEnd != null) setAiWorkHoursEnd(minutesToTimeString(business.aiWorkHoursEnd));
      setAiNeverQuotePrice(business.aiNeverQuotePrice ?? false);
      setAiNeverSendPaymentLink(business.aiNeverSendPaymentLink ?? false);
      setAiNeverOfferDiscount(business.aiNeverOfferDiscount ?? false);
    }
  }, [business]);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?._id) return;
    
    setIsSaving(true);
    try {
      await updateBusiness({
        businessId: business._id,
        name: bizName,
        industry: bizIndustry,
        averageOrderValue: aov,
        responseWindowMinutes: responseWindow,
        followUpTemplate: followUpTemplate,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error("Failed to save", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBehavior = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?._id) return;
    const startMin = timeStringToMinutes(aiWorkHoursStart);
    const endMin = timeStringToMinutes(aiWorkHoursEnd);
    setIsSaving(true);
    try {
      await updateBusiness({
        businessId: business._id,
        aiEnabled,
        aiTone,
        aiLanguageStyle,
        aiBusinessContext: aiBusinessContext.trim() || undefined,
        aiWorkHoursEnabled,
        aiWorkHoursStart: startMin,
        aiWorkHoursEnd: endMin,
        aiNeverQuotePrice,
        aiNeverSendPaymentLink,
        aiNeverOfferDiscount,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error("Failed to save AI behavior", error);
      alert(error instanceof Error ? error.message : "Could not save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleGroup = async (groupJid: string, next: boolean, meta: { groupName?: string; memberCount?: number; role?: "owner" | "admin" | "member" }) => {
    if (!business?._id) return;
    try {
      await setGroupEnabled({
        businessId: business._id,
        groupJid,
        isEnabled: next,
        groupName: meta.groupName,
        memberCount: meta.memberCount,
        role: meta.role && meta.role !== undefined ? meta.role : undefined,
      });
    } catch (err) {
      console.error("Failed to toggle group", err);
      alert("Could not update this group. Please try again.");
    }
  };

  const handleToggleMentionOnly = async (groupJid: string, next: boolean) => {
    if (!business?._id) return;
    try {
      await setGroupMentionOnly({
        businessId: business._id,
        groupJid,
        mentionOnly: next,
      });
    } catch (err) {
      console.error("Failed to update mention-only", err);
    }
  };

  const handleRefreshGroups = async () => {
    if (!business?._id) return;
    setIsRefreshingGroups(true);
    try {
      await refreshGroups({ businessId: business._id });
    } catch (err) {
      console.error("Failed to refresh groups", err);
    } finally {
      setIsRefreshingGroups(false);
    }
  };


  return (
    <>
      <DashboardNavbar />
      <div className={styles.pageRoot}>
        <div className={styles.wrapper}>
          <div>
            <h1 className={styles.pageTitle}>Settings</h1>
            <p className={styles.pageSubtitle}>Manage your workspace and business preferences.</p>
          </div>

          <div className={styles.layoutGrid}>
            {/* Sidebar */}
            <nav className={styles.sidebar}>
              {SETTINGS_GROUPS.map((group) => (
                <div key={group.title}>
                  <div className={styles.groupTitle}>{group.title}</div>
                  <div className={styles.sidebarGroup}>
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`${styles.tabBtn} ${activeTab === item.id ? styles.tabBtnActive : ""}`}
                      >
                        <div className={styles.tabIcon}>
                          {item.icon}
                        </div>
                        <span className={styles.tabLabel}>{item.label}</span>
                        {item.right && (
                          <span className={styles.tabRight}>{item.right}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            {/* Main Content */}
            <div className={styles.contentCard}>
              
              {/* BUSINESS PROFILE TAB */}
              {activeTab === "business" && (
                <div>
                  <div className={styles.tabHeader}>
                    <div className={styles.tabHeaderIcon}>
                      <Building size={22} />
                    </div>
                    <h3 className={styles.tabHeaderTitle}>Business Profile</h3>
                  </div>
                  <p className={styles.tabHeaderDesc}>
                    Update your business name and industry. This information powers the PIPELIXR AI personalization engine.
                  </p>
                  
                  <form onSubmit={handleSaveBusiness} className={styles.form}>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>
                        <Store size={14} className={styles.fieldLabelIcon} /> Business Name
                      </label>
                      <input 
                        type="text" 
                        value={bizName}
                        onChange={(e) => setBizName(e.target.value)}
                        className={styles.fieldInput}
                        placeholder="e.g. Acme Tech"
                        required
                      />
                    </div>
                    
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>
                        <Factory size={14} className={styles.fieldLabelIcon} /> Industry (Optional)
                      </label>
                      <input 
                        type="text" 
                        value={bizIndustry}
                        onChange={(e) => setBizIndustry(e.target.value)}
                        className={styles.fieldInput}
                        placeholder="e.g. Electronics, Commerce"
                      />
                    </div>

                    <div className={styles.submitArea}>
                      <button 
                        type="submit" 
                        disabled={isSaving || !business}
                        className={styles.saveBtn}
                      >
                        {isSaving ? (
                          <div className={styles.spinner} />
                        ) : (
                          <><Save size={18} /> Save Changes</>
                        )}
                      </button>
                      {saveSuccess && (
                        <span className={styles.successMsg}>
                          <span className={styles.successDot}></span> Profile Updated
                        </span>
                      )}
                    </div>
                  </form>
                </div>
              )}

              {/* AUTOMATION TAB */}
              {activeTab === "automation" && (
                <div>
                  <div className={styles.tabHeader}>
                    <div className={styles.tabHeaderIcon}>
                      <Zap size={22} />
                    </div>
                    <h3 className={styles.tabHeaderTitle}>Automation Config</h3>
                  </div>
                  <p className={styles.tabHeaderDesc}>
                    Configure how PIPELIXR automated workflows handle your leads.
                  </p>
                  
                  <form onSubmit={handleSaveBusiness} className={styles.form}>
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>
                        <Banknote size={14} className={styles.fieldLabelIcon} /> Average Order Value (AOV)
                      </label>
                      <p className={styles.helpText} style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem', marginTop: '-0.25rem' }}>
                        Used to calculate Estimated Lost Revenue in the dashboard.
                      </p>
                      <input 
                        type="number" 
                        value={aov}
                        onChange={(e) => setAov(parseInt(e.target.value) || 0)}
                        className={styles.fieldInput}
                        min="0"
                        required
                      />
                    </div>
                    
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>
                        <Clock size={14} className={styles.fieldLabelIcon} /> Response Window (Minutes)
                      </label>
                      <p className={styles.helpText} style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem', marginTop: '-0.25rem' }}>
                        How long to wait for your manual reply before PIPELIXR sends an automated follow-up.
                      </p>
                      <input 
                        type="number" 
                        value={responseWindow}
                        min={30}
                        max={1440}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          setResponseWindow(Math.max(0, Math.min(1440, val)));
                        }}
                        className={styles.fieldInput}
                        required
                      />
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Min: 30 min · Max: 1440 min (24 hours)</span>
                    </div>

                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>
                        <MessageSquare size={14} className={styles.fieldLabelIcon} /> Follow-up Template
                      </label>
                      <p className={styles.helpText} style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem', marginTop: '-0.25rem' }}>
                        The message sent if you miss the response window. Use <code>[Customer Name]</code> as a placeholder.
                      </p>
                      <textarea 
                        value={followUpTemplate}
                        onChange={(e) => setFollowUpTemplate(e.target.value)}
                        className={styles.fieldInput}
                        rows={3}
                        required
                        style={{ resize: 'vertical' }}
                      />
                    </div>

                    <div className={styles.submitArea}>
                      <button 
                        type="submit" 
                        disabled={isSaving || !business}
                        className={styles.saveBtn}
                      >
                        {isSaving ? (
                          <div className={styles.spinner} />
                        ) : (
                          <><Save size={18} /> Save Changes</>
                        )}
                      </button>
                      {saveSuccess && (
                        <span className={styles.successMsg}>
                          <span className={styles.successDot}></span> Config Updated
                        </span>
                      )}
                    </div>
                  </form>
                </div>
              )}

              {/* AI MODELS TAB */}
              {activeTab === "ai" && (
                <div>
                  <div className={styles.tabHeader}>
                    <div className={styles.tabHeaderIcon}>
                      <Brain size={22} />
                    </div>
                    <h3 className={styles.tabHeaderTitle}>AI Models</h3>
                  </div>
                  <p className={styles.tabHeaderDesc}>
                    Pipelixr uses AI to classify messages, analyze images, and generate smart replies. These models run automatically when your WhatsApp is connected.
                  </p>

                  {/* Model Status Cards */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1.5rem", maxWidth: "560px" }}>
                    {/* Groq LLM */}
                    <div style={{
                      padding: "1rem 1.25rem",
                      borderRadius: "0.75rem",
                      background: "rgba(139, 92, 246, 0.06)",
                      border: "1px solid rgba(139, 92, 246, 0.15)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <Brain size={16} style={{ color: "#8b5cf6" }} />
                          <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#e2e8f0" }}>Text Intelligence</span>
                        </div>
                        <span style={{ fontSize: "0.65rem", padding: "0.15rem 0.5rem", borderRadius: "999px", background: "rgba(139,92,246,0.15)", color: "#a78bfa", fontWeight: 600 }}>
                          Groq
                        </span>
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#94a3b8", lineHeight: 1.5 }}>
                        <strong style={{ color: "#cbd5e1" }}>Model:</strong> llama-3.3-70b-versatile<br />
                        <strong style={{ color: "#cbd5e1" }}>Purpose:</strong> Classifies customer messages (buying signal vs noise), generates follow-up replies, understands Nigerian pidgin and context
                      </div>
                      <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                        <CheckCircle2 size={12} style={{ color: "#10b981" }} />
                        <span style={{ fontSize: "0.7rem", color: "#10b981", fontWeight: 600 }}>Active — processes every incoming message</span>
                      </div>
                    </div>

                    {/* OpenAI Vision */}
                    <div style={{
                      padding: "1rem 1.25rem",
                      borderRadius: "0.75rem",
                      background: "rgba(59, 130, 246, 0.06)",
                      border: "1px solid rgba(59, 130, 246, 0.15)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <Eye size={16} style={{ color: "#3b82f6" }} />
                          <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#e2e8f0" }}>Image Analysis</span>
                        </div>
                        <span style={{ fontSize: "0.65rem", padding: "0.15rem 0.5rem", borderRadius: "999px", background: "rgba(59,130,246,0.15)", color: "#60a5fa", fontWeight: 600 }}>
                          OpenAI
                        </span>
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#94a3b8", lineHeight: 1.5 }}>
                        <strong style={{ color: "#cbd5e1" }}>Model:</strong> gpt-4o-mini<br />
                        <strong style={{ color: "#cbd5e1" }}>Purpose:</strong> Analyzes product photos, payment screenshots, and images customers send — detects buying intent from visuals
                      </div>
                      <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                        <CheckCircle2 size={12} style={{ color: "#10b981" }} />
                        <span style={{ fontSize: "0.7rem", color: "#10b981", fontWeight: 600 }}>Active — triggers on image/video messages</span>
                      </div>
                    </div>

                    {/* AI Toggle */}
                    <div style={{
                      padding: "1rem 1.25rem",
                      borderRadius: "0.75rem",
                      background: "rgba(255, 255, 255, 0.02)",
                      border: "1px solid rgba(255, 255, 255, 0.06)",
                    }}>
                      <div className={styles.toggleRow}>
                        <div className={styles.toggleInfo}>
                          <span className={styles.toggleLabel}>AI Processing</span>
                          <span className={styles.toggleSub}>
                            {business?.aiEnabled === false
                              ? "AI is disabled — using keyword matching only"
                              : "AI is active — classifying messages and generating replies"}
                          </span>
                        </div>
                        <div className={`${styles.toggle} ${business?.aiEnabled !== false ? styles.toggleOn : styles.toggleOff}`}>
                          <div className={`${styles.toggleDot} ${business?.aiEnabled !== false ? styles.toggleDotOn : ""}`}></div>
                        </div>
                      </div>
                    </div>

                    {/* How it works */}
                    <div style={{
                      padding: "1rem 1.25rem",
                      borderRadius: "0.75rem",
                      background: "rgba(16, 185, 129, 0.04)",
                      border: "1px solid rgba(16, 185, 129, 0.1)",
                    }}>
                      <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#10b981", margin: "0 0 0.5rem", letterSpacing: "0.05em" }}>HOW IT WORKS</p>
                      <ol style={{ fontSize: "0.78rem", color: "#94a3b8", lineHeight: 1.7, margin: 0, paddingLeft: "1.25rem" }}>
                        <li>Customer sends a WhatsApp message → keywords classify it instantly</li>
                        <li>AI (Groq) re-classifies in the background with conversation context</li>
                        <li>If AI detects a buying signal that keywords missed → upgrades the lead</li>
                        <li>If an image is attached → OpenAI Vision analyzes the product/receipt</li>
                        <li>If you don&apos;t reply in time → AI generates a personalized follow-up</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              {/* AI BEHAVIOR TAB — plain-language, owner-facing controls that
                  shape HOW the assistant replies. Non-technical wording throughout. */}
              {activeTab === "behavior" && (
                <div>
                  <div className={styles.tabHeader}>
                    <div className={styles.tabHeaderIcon}>
                      <Sparkles size={22} />
                    </div>
                    <h3 className={styles.tabHeaderTitle}>AI Behavior</h3>
                  </div>
                  <p className={styles.tabHeaderDesc}>
                    Teach the assistant how to sound and what it should — and shouldn&apos;t — do on your behalf. These settings apply to every AI reply.
                  </p>

                  <form onSubmit={handleSaveBehavior} className={styles.form}>
                    {/* Master switch */}
                    <div className={styles.toggleRow} style={{ marginBottom: "1.25rem", padding: "0.9rem 1rem", borderRadius: "0.75rem", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className={styles.toggleInfo}>
                        <span className={styles.toggleLabel}>Let the AI reply on my behalf</span>
                        <span className={styles.toggleSub}>Turn this off and the AI will only classify leads — it won&apos;t send any messages.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAiEnabled(!aiEnabled)}
                        className={`${styles.toggle} ${aiEnabled ? styles.toggleOn : styles.toggleOff}`}
                        style={{ border: "none", cursor: "pointer" }}
                        aria-pressed={aiEnabled}
                      >
                        <div className={`${styles.toggleDot} ${aiEnabled ? styles.toggleDotOn : ""}`}></div>
                      </button>
                    </div>

                    {/* Business context — the single most important field */}
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>
                        <Store size={14} className={styles.fieldLabelIcon} /> What does your business do?
                      </label>
                      <p className={styles.helpText} style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: "0.5rem", marginTop: "-0.25rem" }}>
                        One or two sentences. The AI reads this before every reply.
                      </p>
                      <textarea
                        value={aiBusinessContext}
                        onChange={(e) => setAiBusinessContext(e.target.value.slice(0, 500))}
                        className={styles.fieldInput}
                        rows={3}
                        placeholder="e.g. We sell affordable sneakers to young Nigerians on WhatsApp."
                        style={{ resize: "vertical" }}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#64748b", marginTop: "0.35rem" }}>
                        <span>{aiBusinessContext.length}/500</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.5rem" }}>
                        {BUSINESS_CONTEXT_EXAMPLES.map((ex) => (
                          <button
                            type="button"
                            key={ex}
                            onClick={() => setAiBusinessContext(ex)}
                            style={{
                              fontSize: "0.7rem",
                              padding: "0.3rem 0.6rem",
                              borderRadius: "999px",
                              background: "rgba(139,92,246,0.08)",
                              border: "1px solid rgba(139,92,246,0.2)",
                              color: "#c4b5fd",
                              cursor: "pointer",
                            }}
                          >
                            Use this example
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Tone */}
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>
                        <MessageSquare size={14} className={styles.fieldLabelIcon} /> How should the AI sound?
                      </label>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                        {([
                          { id: "friendly", label: "Friendly", desc: "Warm & casual" },
                          { id: "professional", label: "Professional", desc: "Polite & polished" },
                          { id: "playful", label: "Playful", desc: "Upbeat & fun" },
                        ] as const).map((opt) => (
                          <button
                            type="button"
                            key={opt.id}
                            onClick={() => setAiTone(opt.id)}
                            style={{
                              flex: "1 1 140px",
                              padding: "0.75rem 0.9rem",
                              borderRadius: "0.6rem",
                              background: aiTone === opt.id ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.02)",
                              border: `1px solid ${aiTone === opt.id ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.08)"}`,
                              color: aiTone === opt.id ? "#e9d5ff" : "#cbd5e1",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>{opt.label}</div>
                            <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Language */}
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>
                        <MessageSquare size={14} className={styles.fieldLabelIcon} /> What language should it use?
                      </label>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                        {([
                          { id: "english", label: "English" },
                          { id: "pidgin", label: "Pidgin" },
                          { id: "mixed", label: "Mix of both" },
                        ] as const).map((opt) => (
                          <button
                            type="button"
                            key={opt.id}
                            onClick={() => setAiLanguageStyle(opt.id)}
                            style={{
                              padding: "0.55rem 1rem",
                              borderRadius: "999px",
                              background: aiLanguageStyle === opt.id ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.02)",
                              border: `1px solid ${aiLanguageStyle === opt.id ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.08)"}`,
                              color: aiLanguageStyle === opt.id ? "#e9d5ff" : "#cbd5e1",
                              cursor: "pointer",
                              fontSize: "0.8rem",
                              fontWeight: 600,
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Work hours */}
                    <div className={styles.fieldGroup}>
                      <div className={styles.toggleRow} style={{ padding: 0, background: "transparent", border: "none" }}>
                        <div className={styles.toggleInfo}>
                          <span className={styles.toggleLabel}><Clock size={14} style={{ display: "inline", marginRight: "0.35rem", verticalAlign: "middle" }} /> Only reply during my work hours</span>
                          <span className={styles.toggleSub}>Outside these hours, the AI will stay quiet and let you handle chats yourself.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAiWorkHoursEnabled(!aiWorkHoursEnabled)}
                          className={`${styles.toggle} ${aiWorkHoursEnabled ? styles.toggleOn : styles.toggleOff}`}
                          style={{ border: "none", cursor: "pointer" }}
                          aria-pressed={aiWorkHoursEnabled}
                        >
                          <div className={`${styles.toggleDot} ${aiWorkHoursEnabled ? styles.toggleDotOn : ""}`}></div>
                        </button>
                      </div>
                      {aiWorkHoursEnabled && (
                        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem", alignItems: "center" }}>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: "0.72rem", color: "#94a3b8", display: "block", marginBottom: "0.25rem" }}>From</label>
                            <input type="time" value={aiWorkHoursStart} onChange={(e) => setAiWorkHoursStart(e.target.value)} className={styles.fieldInput} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: "0.72rem", color: "#94a3b8", display: "block", marginBottom: "0.25rem" }}>To</label>
                            <input type="time" value={aiWorkHoursEnd} onChange={(e) => setAiWorkHoursEnd(e.target.value)} className={styles.fieldInput} />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Guardrails */}
                    <div className={styles.fieldGroup}>
                      <label className={styles.fieldLabel}>
                        <Shield size={14} className={styles.fieldLabelIcon} /> Things the AI should never do
                      </label>
                      <p className={styles.helpText} style={{ fontSize: "0.8rem", color: "#94a3b8", marginTop: "-0.25rem", marginBottom: "0.75rem" }}>
                        Pick anything you want the AI to leave to you.
                      </p>
                      {[
                        { label: "Never quote a specific price", val: aiNeverQuotePrice, set: setAiNeverQuotePrice, hint: "The AI will say you'll confirm the price shortly." },
                        { label: "Never send a payment link or account", val: aiNeverSendPaymentLink, set: setAiNeverSendPaymentLink, hint: "All payment details stay with you." },
                        { label: "Never offer a discount", val: aiNeverOfferDiscount, set: setAiNeverOfferDiscount, hint: "The AI won't promise price cuts." },
                      ].map((rule) => (
                        <div key={rule.label} className={styles.toggleRow} style={{ padding: "0.7rem 0.9rem", borderRadius: "0.6rem", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: "0.5rem" }}>
                          <div className={styles.toggleInfo}>
                            <span className={styles.toggleLabel} style={{ fontSize: "0.85rem" }}>{rule.label}</span>
                            <span className={styles.toggleSub}>{rule.hint}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => rule.set(!rule.val)}
                            className={`${styles.toggle} ${rule.val ? styles.toggleOn : styles.toggleOff}`}
                            style={{ border: "none", cursor: "pointer" }}
                            aria-pressed={rule.val}
                          >
                            <div className={`${styles.toggleDot} ${rule.val ? styles.toggleDotOn : ""}`}></div>
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className={styles.submitArea}>
                      <button type="submit" disabled={isSaving || !business} className={styles.saveBtn}>
                        {isSaving ? <div className={styles.spinner} /> : (<><Save size={18} /> Save AI Behavior</>)}
                      </button>
                      {saveSuccess && (
                        <span className={styles.successMsg}>
                          <span className={styles.successDot}></span> Saved
                        </span>
                      )}
                    </div>
                  </form>
                </div>
              )}

              {/* GROUPS & COMMUNITIES TAB — owner-controlled AI scope for group chats.
                  AI stays silent in every group by default; owners opt-in per group here. */}
              {activeTab === "groups" && (
                <div>
                  <div className={styles.tabHeader}>
                    <div className={styles.tabHeaderIcon}>
                      <Users size={22} />
                    </div>
                    <h3 className={styles.tabHeaderTitle}>Groups &amp; Communities</h3>
                  </div>
                  <p className={styles.tabHeaderDesc}>
                    Pick which of your WhatsApp groups the AI is allowed to work in. It will stay silent in every other group, so it never disturbs communities you&apos;re just a member of.
                  </p>

                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: "0.4rem", background: "rgba(255,255,255,0.03)", padding: "0.25rem", borderRadius: "999px" }}>
                      {([
                        { id: "managed", label: "Groups I manage" },
                        { id: "all", label: "All groups" },
                      ] as const).map((opt) => (
                        <button
                          type="button"
                          key={opt.id}
                          onClick={() => setGroupsFilter(opt.id)}
                          style={{
                            padding: "0.4rem 0.85rem",
                            borderRadius: "999px",
                            background: groupsFilter === opt.id ? "rgba(139,92,246,0.2)" : "transparent",
                            border: "none",
                            color: groupsFilter === opt.id ? "#e9d5ff" : "#94a3b8",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleRefreshGroups}
                      disabled={isRefreshingGroups || !business}
                      style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        padding: "0.4rem 0.85rem",
                        borderRadius: "0.5rem",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "#cbd5e1",
                        fontSize: "0.75rem",
                        cursor: isRefreshingGroups ? "not-allowed" : "pointer",
                        opacity: isRefreshingGroups ? 0.6 : 1,
                      }}
                    >
                      <RefreshCw size={13} style={{ animation: isRefreshingGroups ? "spin 1s linear infinite" : undefined }} />
                      {isRefreshingGroups ? "Refreshing..." : "Refresh from WhatsApp"}
                    </button>
                  </div>

                  {!groups && (
                    <div style={{ padding: "2rem", textAlign: "center", color: "#64748b", fontSize: "0.85rem" }}>
                      Loading your groups...
                    </div>
                  )}

                  {groups && visibleGroups.length === 0 && (
                    <div style={{ padding: "2rem 1rem", textAlign: "center", color: "#94a3b8", fontSize: "0.85rem", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: "0.6rem" }}>
                      {groupsFilter === "managed"
                        ? "No groups you manage yet. If you own or admin a WhatsApp group, click Refresh to pull them in — or switch to All groups."
                        : "No WhatsApp groups found for this account."}
                    </div>
                  )}

                  {groups && visibleGroups.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      {visibleGroups.map((g) => (
                        <div
                          key={g.groupJid}
                          style={{
                            padding: "0.85rem 1rem",
                            borderRadius: "0.6rem",
                            background: g.isEnabled ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.02)",
                            border: `1px solid ${g.isEnabled ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)"}`,
                            display: "flex",
                            gap: "1rem",
                            alignItems: "center",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#e2e8f0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.groupName}</span>
                              {g.role === "owner" && (
                                <span style={{ fontSize: "0.6rem", padding: "0.1rem 0.4rem", borderRadius: "999px", background: "rgba(139,92,246,0.2)", color: "#c4b5fd", fontWeight: 700, letterSpacing: "0.05em" }}>OWNER</span>
                              )}
                              {g.role === "admin" && (
                                <span style={{ fontSize: "0.6rem", padding: "0.1rem 0.4rem", borderRadius: "999px", background: "rgba(59,130,246,0.2)", color: "#93c5fd", fontWeight: 700, letterSpacing: "0.05em" }}>ADMIN</span>
                              )}
                              {g.role === "member" && (
                                <span style={{ fontSize: "0.6rem", padding: "0.1rem 0.4rem", borderRadius: "999px", background: "rgba(255,255,255,0.05)", color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em" }}>MEMBER</span>
                              )}
                            </div>
                            <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>
                              {g.memberCount > 0 ? `${g.memberCount} members · ` : ""}
                              {g.isEnabled
                                ? (g.mentionOnly ? "AI replies only when tagged" : "AI replies to any buying signal")
                                : "AI is silent here"}
                            </div>
                          </div>

                          {g.isEnabled && (
                            <button
                              type="button"
                              onClick={() => handleToggleMentionOnly(g.groupJid, !g.mentionOnly)}
                              title="Toggle: only reply when tagged, or on any buying signal"
                              style={{
                                fontSize: "0.7rem",
                                padding: "0.35rem 0.7rem",
                                borderRadius: "0.5rem",
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                color: "#cbd5e1",
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {g.mentionOnly ? "Only when tagged" : "Any buying signal"}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleToggleGroup(g.groupJid, !g.isEnabled, {
                              groupName: g.groupName,
                              memberCount: g.memberCount,
                              role: g.role === "unknown" ? undefined : g.role,
                            })}
                            className={`${styles.toggle} ${g.isEnabled ? styles.toggleOn : styles.toggleOff}`}
                            style={{ border: "none", cursor: "pointer", flexShrink: 0 }}
                            aria-pressed={g.isEnabled}
                          >
                            <div className={`${styles.toggleDot} ${g.isEnabled ? styles.toggleDotOn : ""}`}></div>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: "1.25rem", padding: "0.85rem 1rem", borderRadius: "0.6rem", background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)", fontSize: "0.75rem", color: "#cbd5e1", lineHeight: 1.5 }}>
                    <strong style={{ color: "#93c5fd" }}>How this works:</strong> By default, the AI never speaks in group chats — only in your one-on-one WhatsApp DMs. Enable a group here to let the AI notice buying signals and reply on your behalf inside that group.
                  </div>
                </div>
              )}

              {/* NOTIFICATIONS TAB */}
              {activeTab === "notifications" && (

                <div>
                  <div className={styles.tabHeader}>
                    <div className={styles.tabHeaderIcon}>
                      <Bell size={22} />
                    </div>
                    <h3 className={styles.tabHeaderTitle}>Notification Preferences</h3>
                  </div>
                  <p className={styles.tabHeaderDesc}>
                    Control how PIPELIXR alerts you about new leads, automated replies, and pipeline updates.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '520px' }}>
                    {["Browser Notifications", "Email Digest", "Sound Alerts"].map((label, idx) => (
                      <div key={label} className={styles.toggleRow}>
                        <div className={styles.toggleInfo}>
                          <span className={styles.toggleLabel}>{label}</span>
                          <span className={styles.toggleSub}>Handled by system defaults</span>
                        </div>
                        <div className={`${styles.toggle} ${idx === 0 ? styles.toggleOn : styles.toggleOff}`}>
                          <div className={`${styles.toggleDot} ${idx === 0 ? styles.toggleDotOn : ""}`}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* OTHER TABS */}
              {(activeTab !== "business" && activeTab !== "notifications" && activeTab !== "automation" && activeTab !== "ai" && activeTab !== "behavior" && activeTab !== "groups") && (

                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>
                    <Shield size={36} strokeWidth={1.5} />
                  </div>
                  <h3 className={styles.emptyTitle}>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h3>
                  <p className={styles.emptyDesc}>This module is being optimized for the new PIPELIXR OS ecosystem. Check back soon.</p>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </>
  );
}
