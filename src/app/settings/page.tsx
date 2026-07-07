"use client";

import React, { useState, useEffect } from "react";
import { Bell, Shield, Building, Moon, ChevronRight, Save, Store, Factory, Zap, Clock, Banknote, MessageSquare } from "lucide-react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation } from "convex/react";
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
      { id: "automation", label: "Automation Config", icon: <Zap size={18} /> },
      { id: "notifications", label: "Notifications", icon: <Bell size={18} /> },
      { id: "security", label: "Security", icon: <Shield size={18} /> },
    ]
  },
  {
    title: "App",
    items: [
      { id: "theme", label: "Appearance", icon: <Moon size={18} />, right: "Dark" },
    ]
  }
];

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

  useEffect(() => {
    if (business) {
      setBizName(business.name || "");
      setBizIndustry(business.industry || "");
      if (business.averageOrderValue) setAov(business.averageOrderValue);
      if (business.responseWindowMinutes) setResponseWindow(business.responseWindowMinutes);
      if (business.followUpTemplate) setFollowUpTemplate(business.followUpTemplate);
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
              {(activeTab !== "business" && activeTab !== "notifications" && activeTab !== "automation") && (
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
