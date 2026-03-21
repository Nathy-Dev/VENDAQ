"use client";

import { useState, useEffect } from "react";
import { Bell, Shield, Building, Moon, ChevronRight, Save, Store, Factory } from "lucide-react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

type SettingsItem = {
  id: string;
  label: string;
  icon: JSX.Element;
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
      { id: "business", label: "Business Profile", icon: <Building size={18} />, color: "text-blue-400", bg: "bg-blue-500/10" },
      { id: "notifications", label: "Notifications", icon: <Bell size={18} />, color: "text-emerald-400", bg: "bg-emerald-500/10" },
      { id: "security", label: "Security", icon: <Shield size={18} />, color: "text-purple-400", bg: "bg-purple-500/10" },
    ]
  },
  {
    title: "App",
    items: [
      { id: "theme", label: "Appearance", icon: <Moon size={18} />, color: "text-orange-400", bg: "bg-orange-500/10", right: "Dark" },
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
    <div className="p-8 max-w-4xl mx-auto text-slate-200">
      <h1 className="text-3xl font-bold mb-3 text-white">Settings</h1>
      <p className="text-slate-400 mb-8 font-medium">Manage your workspace and business preferences.</p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Sidebar */}
        <aside className="md:col-span-1 space-y-8">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.title}>
              <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 px-2">{group.title}</h2>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl transition-all duration-200 group ${
                      activeTab === item.id 
                        ? "bg-slate-800 text-white font-semibold shadow-inner border border-slate-700" 
                        : "hover:bg-slate-800/50 text-slate-400 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.bg} ${item.color}`}>
                        {item.icon}
                      </div>
                      <span className="text-sm">{item.label}</span>
                    </div>
                    {item.right ? (
                      <span className="text-[10px] font-bold text-slate-500 uppercase">{item.right}</span>
                    ) : (
                      <ChevronRight size={14} className={`text-slate-600 transition-transform ${activeTab === item.id ? "translate-x-1" : "group-hover:translate-x-1"}`} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        {/* Main Content Area */}
        <main className="md:col-span-3">
          <div className="bg-[#0f172a]/60 backdrop-blur-md rounded-2xl p-8 border border-slate-800 shadow-xl min-h-[500px]">
            
            {/* BUSINESS PROFILE TAB */}
            {activeTab === "business" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                    <Building size={20} />
                  </div>
                  <h3 className="text-xl font-bold text-white">Business Profile</h3>
                </div>
                <p className="text-slate-400 text-sm mb-8 pb-6 border-b border-slate-800">
                  Update your business name and industry. This information is used for AI personalization.
                </p>
                
                <form onSubmit={handleSaveBusiness} className="space-y-6 max-w-md">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Store size={14} /> Business Name
                    </label>
                    <input 
                      type="text" 
                      value={bizName}
                      onChange={(e) => setBizName(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-medium"
                      placeholder="e.g. Acme Tech"
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Factory size={14} /> Industry (Optional)
                    </label>
                    <input 
                      type="text" 
                      value={bizIndustry}
                      onChange={(e) => setBizIndustry(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-medium"
                      placeholder="e.g. Electronics, Fashion"
                    />
                  </div>

                  <div className="pt-4 flex items-center gap-4 border-t border-slate-800 mt-8!">
                    <button 
                      type="submit" 
                      disabled={isSaving || !business}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-bold py-2.5 px-6 rounded-xl transition-colors shadow-lg shadow-blue-900/20"
                    >
                      {isSaving ? (
                        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      ) : (
                        <><Save size={18} /> Save Changes</>
                      )}
                    </button>
                    {saveSuccess && (
                      <span className="text-emerald-400 text-sm font-bold animate-in fade-in">✓ Profile Updated</span>
                    )}
                  </div>
                </form>
              </div>
            )}

            {/* NOTIFICATIONS TAB */}
            {activeTab === "notifications" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg">
                    <Bell size={20} />
                  </div>
                  <h3 className="text-xl font-bold text-white">Notification Preferences</h3>
                </div>
                <p className="text-slate-400 text-sm mb-8 pb-6 border-b border-slate-800">
                  Control how PIPELIXR alerts you about new leads and pipeline updates.
                </p>
                <div className="space-y-6 max-w-md">
                  {["Browser Notifications", "Email Digest", "Sound Alerts"].map((label, idx) => (
                    <div key={label} className="flex items-center justify-between p-4 bg-slate-800/30 rounded-xl border border-slate-800">
                      <div>
                        <span className="font-bold text-slate-200 block">{label}</span>
                        <span className="text-xs text-slate-500">Currently managed by system default.</span>
                      </div>
                      <div className={`w-12 h-6 rounded-full relative p-1 cursor-pointer transition-colors ${idx === 0 ? "bg-emerald-500" : "bg-slate-700"}`}>
                        <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${idx === 0 ? "translate-x-6" : ""}`}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* OTHER TABS */}
            {(activeTab !== "business" && activeTab !== "notifications") && (
              <div className="flex flex-col items-center justify-center h-full text-center py-20 animate-in fade-in duration-500">
                <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mb-6 text-slate-500 border border-slate-700 shadow-inner">
                  <Shield size={32} strokeWidth={1.5} />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h3>
                <p className="text-slate-400 text-sm max-w-sm leading-relaxed">This section is currently being updated for the new PIPELIXR OS design system. Check back soon.</p>
              </div>
            )}

          </div>
        </main>
      </div>
    </div>
  );
}
