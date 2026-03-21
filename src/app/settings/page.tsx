"use client";

import React, { useState, useEffect } from "react";
import { Bell, Shield, Building, Moon, ChevronRight, Save, Store, Factory } from "lucide-react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import DashboardNavbar from "@/components/DashboardNavbar";

type SettingsItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  right?: string;
};

type SettingsGroup = {
  title: string;
  items: SettingsItem[];
};

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: "Account",
    items: [
      { id: "business", label: "Business Profile", icon: <Building size={18} />, color: "text-slate-400", bg: "bg-slate-800/40" },
      { id: "notifications", label: "Notifications", icon: <Bell size={18} />, color: "text-slate-400", bg: "bg-slate-800/40" },
      { id: "security", label: "Security", icon: <Shield size={18} />, color: "text-slate-400", bg: "bg-slate-800/40" },
    ]
  },
  {
    title: "App",
    items: [
      { id: "theme", label: "Appearance", icon: <Moon size={18} />, color: "text-slate-400", bg: "bg-slate-800/40", right: "Dark" },
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
    <div className="flex flex-col min-h-screen bg-[#020617] text-slate-200">
      <DashboardNavbar />
      
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <div className="mb-8 md:mb-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-3 text-white tracking-tight">Settings</h1>
          <p className="text-slate-400 font-medium text-sm md:text-base">Manage your workspace and business preferences.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Sidebar */}
          <aside className="lg:col-span-3 space-y-6 md:space-y-8 flex flex-col sm:flex-row lg:flex-col gap-4 sm:gap-6 lg:gap-0 overflow-x-auto pb-4 lg:pb-0 scrollbar-hide">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.title} className="min-w-[200px] lg:min-w-0">
                <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 md:mb-4 px-2">{group.title}</h2>
                <div className="flex sm:flex-col gap-2 sm:gap-1">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`flex-shrink-0 lg:w-full flex items-center justify-between p-3 rounded-xl transition-all duration-300 group ${
                        activeTab === item.id 
                          ? "bg-slate-800/80 text-white font-semibold shadow-inner border border-emerald-500/30" 
                          : "hover:bg-slate-800/60 text-slate-400 border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                          activeTab === item.id 
                            ? "bg-emerald-500/20 text-emerald-400" 
                            : `${item.bg} ${item.color} group-hover:bg-slate-700/50 group-hover:text-slate-300`
                        }`}>
                          {item.icon}
                        </div>
                        <span className="text-sm md:text-base whitespace-nowrap">{item.label}</span>
                      </div>
                      {item.right ? (
                        <span className="hidden lg:inline-block text-[10px] font-bold text-slate-500 uppercase tracking-wider">{item.right}</span>
                      ) : (
                        <ChevronRight size={16} className={`hidden lg:block transition-transform ${activeTab === item.id ? "text-emerald-500 translate-x-1" : "text-slate-600 group-hover:translate-x-1"}`} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </aside>

          {/* Main Content Area */}
          <section className="lg:col-span-9">
            <div className="bg-[#0f172a]/80 backdrop-blur-xl rounded-3xl p-6 md:p-10 border border-slate-800 shadow-2xl min-h-[500px]">
              
              {/* BUSINESS PROFILE TAB */}
              {activeTab === "business" && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/10 shadow-sm">
                      <Building size={24} />
                    </div>
                    <h3 className="text-2xl font-black text-white tracking-tight">Business Profile</h3>
                  </div>
                  <p className="text-slate-400 text-sm md:text-base mb-8 pb-8 border-b border-slate-800/80">
                    Update your business name and industry. This information powers the PIPELIXR AI personalization engine.
                  </p>
                  
                  <form onSubmit={handleSaveBusiness} className="space-y-6 max-w-xl">
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Store size={14} className="text-emerald-500" /> Business Name
                      </label>
                      <input 
                        type="text" 
                        value={bizName}
                        onChange={(e) => setBizName(e.target.value)}
                        className="w-full bg-[#020617]/50 border border-slate-700 text-white rounded-xl px-5 py-3.5 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-medium shadow-inner"
                        placeholder="e.g. Acme Tech"
                        required
                      />
                    </div>
                    
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Factory size={14} className="text-emerald-500" /> Industry (Optional)
                      </label>
                      <input 
                        type="text" 
                        value={bizIndustry}
                        onChange={(e) => setBizIndustry(e.target.value)}
                        className="w-full bg-[#020617]/50 border border-slate-700 text-white rounded-xl px-5 py-3.5 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-medium shadow-inner"
                        placeholder="e.g. Electronics, Commerce"
                      />
                    </div>

                    <div className="pt-8 flex flex-col sm:flex-row sm:items-center gap-6 border-t border-slate-800/80 mt-10!">
                      <button 
                        type="submit" 
                        disabled={isSaving || !business}
                        className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed py-3.5 px-8 text-sm uppercase tracking-widest font-bold shadow-lg shadow-emerald-900/20 hover:shadow-emerald-900/40"
                      >
                        {isSaving ? (
                          <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        ) : (
                          <><Save size={18} /> Save Changes</>
                        )}
                      </button>
                      {saveSuccess && (
                        <span className="text-emerald-400 text-sm font-bold animate-in fade-in flex items-center justify-center sm:justify-start">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 mr-2 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"></span> Profile Successfully Updated
                        </span>
                      )}
                    </div>
                  </form>
                </div>
              )}

              {/* NOTIFICATIONS TAB */}
              {activeTab === "notifications" && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/10 shadow-sm">
                      <Bell size={24} />
                    </div>
                    <h3 className="text-2xl font-black text-white tracking-tight">Notification Preferences</h3>
                  </div>
                  <p className="text-slate-400 text-sm md:text-base mb-8 pb-8 border-b border-slate-800/80">
                    Control how PIPELIXR alerts you about new leads, automated replies, and pipeline stage updates.
                  </p>
                  <div className="space-y-4 max-w-xl">
                    {["Browser Notifications", "Email Digest", "Sound Alerts"].map((label, idx) => (
                      <div key={label} className="flex items-center justify-between p-5 bg-slate-800/30 rounded-2xl border border-slate-800/60 hover:bg-slate-800/50 hover:border-slate-700 transition-all shadow-sm">
                        <div>
                          <span className="font-bold text-slate-100 block text-base md:text-lg">{label}</span>
                          <span className="text-xs text-slate-500 mt-1.5 block uppercase tracking-wider">Currently handled by system defaults.</span>
                        </div>
                        <div className={`w-14 h-7 rounded-full relative p-1 cursor-pointer transition-colors ${idx === 0 ? "bg-emerald-500 shadow-lg shadow-emerald-500/20" : "bg-slate-700 hover:bg-slate-600"}`}>
                          <div className={`w-5 h-5 bg-white rounded-full shadow-md transition-transform ${idx === 0 ? "translate-x-7" : ""}`}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* OTHER TABS */}
              {(activeTab !== "business" && activeTab !== "notifications") && (
                <div className="flex flex-col items-center justify-center h-full text-center py-24 animate-in fade-in duration-500">
                  <div className="w-24 h-24 bg-slate-800/30 rounded-full flex items-center justify-center mb-8 text-slate-500 border border-slate-700/50 shadow-inner">
                    <Shield size={40} strokeWidth={1.5} className="opacity-70" />
                  </div>
                  <h3 className="text-3xl font-black text-white mb-3 tracking-tight">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h3>
                  <p className="text-slate-400 text-sm md:text-base max-w-sm leading-relaxed">This module is currently being optimized for the new PIPELIXR OS ecosystem. Check back soon for updates.</p>
                </div>
              )}

            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
