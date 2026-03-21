"use client";

import React, { useState, useEffect } from "react";
import { Bell, Shield, Building, Moon, ChevronRight, Save, Store, Factory } from "lucide-react";
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

const SETTINGS_GROUPS = [
  {
    title: "Account",
    items: [
      { id: "business", label: "Business Profile", icon: <Building size={18} /> },
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
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (business) {
      setBizName(business.name || "");
      setBizIndustry(business.industry || "");
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
              {(activeTab !== "business" && activeTab !== "notifications") && (
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
