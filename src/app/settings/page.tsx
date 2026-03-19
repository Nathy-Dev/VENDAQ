"use client";

import { useState } from "react";
import { Bell, Lock, Globe, Smartphone, Moon, ChevronRight } from "lucide-react";

const SETTINGS_GROUPS = [
  {
    title: "Account",
    items: [
      { id: "notifications", label: "Notifications", icon: <Bell size={18} />, color: "text-blue-500", bg: "bg-blue-50" },
      { id: "security", label: "Privacy & Security", icon: <Lock size={18} />, color: "text-green-500", bg: "bg-green-50" },
      { id: "language", label: "Language", icon: <Globe size={18} />, color: "text-purple-500", bg: "bg-purple-50" },
    ]
  },
  {
    title: "Preferences",
    items: [
      { id: "theme", label: "Theme", icon: <Moon size={18} />, color: "text-slate-500", bg: "bg-slate-50", right: "System" },
      { id: "devices", label: "Linked Devices", icon: <Smartphone size={18} />, color: "text-orange-500", bg: "bg-orange-50" },
    ]
  }
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("general");

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-3 text-slate-800">Settings</h1>
      <p className="text-slate-500 mb-8 font-medium">Manage your application preferences and account security.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <aside className="md:col-span-1 space-y-8">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.title}>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 px-2">{group.title}</h2>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl transition-all duration-200 group ${
                      activeTab === item.id 
                        ? "bg-white shadow-sm border border-slate-100 font-semibold" 
                        : "hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.bg} ${item.color}`}>
                        {item.icon}
                      </div>
                      <span>{item.label}</span>
                    </div>
                    {item.right ? (
                      <span className="text-xs font-medium text-slate-400">{item.right}</span>
                    ) : (
                      <ChevronRight size={16} className={`text-slate-300 transition-transform ${activeTab === item.id ? "translate-x-1" : "group-hover:translate-x-1"}`} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <main className="md:col-span-2">
          <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm min-h-[400px]">
            {activeTab === "notifications" && (
              <div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Notification Settings</h3>
                <p className="text-slate-500 text-sm mb-6 pb-6 border-b border-slate-50 font-medium">Choose how you want to be notified about updates.</p>
                <div className="space-y-6">
                  {["Browser Notifications", "Email Alerts", "WhatsApp Messages"].map((label) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">{label}</span>
                      <div className="w-12 h-6 bg-slate-200 rounded-full relative p-1 cursor-pointer">
                        <div className="w-4 h-4 bg-white rounded-full shadow-sm ml-auto"></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {(activeTab !== "notifications") && (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-6 text-slate-400">
                  <Globe size={32} strokeWidth={1.5} />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Settings</h3>
                <p className="text-slate-400 text-sm max-w-xs font-medium">This section is currently under development. Please check back later.</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
