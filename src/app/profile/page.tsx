"use client";

import { useSession } from "next-auth/react";
import { User, Mail, Shield, Building, Edit3, Smartphone, Activity } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";
import DashboardNavbar from "@/components/DashboardNavbar";

export default function ProfilePage() {
  const { data: session } = useSession();
  
  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );
  
  return (
    <div className="flex flex-col min-h-screen bg-[#020617] text-slate-200">
      <DashboardNavbar />
      
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-8 md:mb-12">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">Your Profile</h1>
            <p className="text-slate-400 mt-2 font-medium text-sm md:text-base">Manage your personal operator identity and business entity here.</p>
          </div>
          <Link href="/settings" className="inline-flex items-center justify-center gap-2 bg-slate-800/80 hover:bg-slate-700 text-white text-sm font-bold py-3 px-6 rounded-xl border border-slate-700/80 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 w-full sm:w-auto">
            <Edit3 size={16} className="text-emerald-400" /> Edit Settings
          </Link>
        </div>
        
        {/* Main Profile Header Card */}
        <div className="bg-[#0f172a]/80 backdrop-blur-xl rounded-3xl border border-slate-800 overflow-hidden shadow-2xl mb-8 md:mb-10 lg:mb-12">
          {/* Cover Photo / Banner */}
          <div className="h-28 md:h-48 relative bg-gradient-to-r from-emerald-600/20 via-blue-600/10 to-purple-600/20 border-b border-slate-800/80">
            <div className="absolute -bottom-12 md:-bottom-16 left-6 md:left-12">
              <div className="w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-slate-900 border-[6px] border-[#0f172a] shadow-xl flex items-center justify-center text-emerald-400 text-4xl md:text-6xl font-black overflow-hidden relative group">
                {session?.user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={session.user.image} alt="User Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span>{session?.user?.name?.[0]?.toUpperCase() || "U"}</span>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer backdrop-blur-sm">
                  <Edit3 size={24} className="text-white" />
                </div>
              </div>
            </div>
            
            <div className="absolute bottom-4 right-6 hidden sm:flex gap-2">
              <span className="bg-[#0f172a]/60 backdrop-blur-sm border border-slate-700/50 text-slate-300 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg shadow-sm">
                Role: <span className="text-emerald-400 ml-1">Admin</span>
              </span>
            </div>
          </div>
          
          <div className="pt-16 md:pt-24 pb-8 md:pb-12 px-6 md:px-12">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 mt-2">
              
              {/* Personal Details Panel */}
              <div className="bg-slate-800/20 rounded-2xl border border-slate-800/60 p-6 md:p-8 hover:bg-slate-800/30 transition-all duration-300 group shadow-inner">
                <div className="flex items-center gap-4 mb-8">
                  <div className="p-2.5 bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/10">
                    <User size={20} />
                  </div>
                  <h2 className="text-sm font-bold text-slate-300 uppercase tracking-widest">Personal Identification</h2>
                </div>
                
                <div className="space-y-8">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                       Operator Name
                    </label>
                    <p className="text-xl md:text-2xl text-white font-medium border-b border-slate-800/80 pb-3 group-hover:border-slate-700/50 transition-colors truncate">
                      {session?.user?.name || "Loading Entity Data..."}
                    </p>
                  </div>
                  
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2 tracking-widest mb-2">
                       <Mail size={14} className="text-emerald-500" /> Authorized Email
                    </label>
                    <p className="text-lg md:text-xl text-slate-300 font-medium border-b border-slate-800/80 pb-3 group-hover:border-slate-700/50 transition-colors truncate">
                      {session?.user?.email || "Fetching..."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Business Entity Panel */}
              <div className="bg-slate-800/20 rounded-2xl border border-slate-800/60 p-6 md:p-8 hover:bg-slate-800/30 transition-all duration-300 group shadow-inner">
                <div className="flex items-center gap-4 mb-8">
                  <div className="p-2.5 bg-blue-500/10 text-blue-500 rounded-xl border border-blue-500/10">
                    <Building size={20} />
                  </div>
                  <h2 className="text-sm font-bold text-slate-300 uppercase tracking-widest">Business Entity</h2>
                </div>
                
                <div className="space-y-8">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                      Registered Workspace
                    </label>
                    <p className="text-xl md:text-2xl text-white font-medium border-b border-slate-800/80 pb-3 group-hover:border-slate-700/50 transition-colors truncate">
                      {business ? business.name : "Loading Virtual Workspace..."}
                    </p>
                  </div>
                  
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2 tracking-widest mb-2">
                      <Smartphone size={14} className="text-blue-500" /> WhatsApp Cloud API
                    </label>
                    <div className="border-b border-slate-800/80 pb-3 group-hover:border-slate-700/50 transition-colors flex items-center min-h-[44px]">
                      {business?.whatsappStatus === "connected" ? (
                        <span className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-4 py-1.5 rounded-full text-xs font-bold border border-emerald-500/20 shadow-sm shadow-emerald-500/5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"></span> Connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2 bg-red-500/10 text-red-400 px-4 py-1.5 rounded-full text-xs font-bold border border-red-500/20 shadow-sm shadow-red-500/5">
                          <span className="w-2 h-2 rounded-full bg-red-500"></span> Disconnected
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
            </div>
          </div>
        </div>
        
        {/* System & Architecture Status Cards - Full Width Desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-[#0f172a]/60 backdrop-blur-md p-6 md:p-8 rounded-3xl border border-slate-800 shadow-xl flex flex-col sm:flex-row items-start gap-5 hover:bg-[#0f172a]/80 hover:border-emerald-500/30 hover:shadow-emerald-500/5 transition-all duration-300">
            <div className="w-14 h-14 bg-emerald-500/10 text-emerald-500 rounded-2xl flex items-center justify-center shrink-0 border border-emerald-500/20 shadow-inner">
              <Shield size={28} />
            </div>
            <div>
              <h3 className="text-lg md:text-xl font-bold text-white tracking-tight">Account Security</h3>
              <p className="text-sm md:text-base text-slate-400 mt-2.5 leading-relaxed">
                Your operator identity is secured with enterprise-grade OAuth validation. Cryptographic password management is delegated externally.
              </p>
            </div>
          </div>
          
          <div className="bg-[#0f172a]/60 backdrop-blur-md p-6 md:p-8 rounded-3xl border border-slate-800 shadow-xl flex flex-col sm:flex-row items-start gap-5 hover:bg-[#0f172a]/80 hover:border-blue-500/30 hover:shadow-blue-500/5 transition-all duration-300">
            <div className="w-14 h-14 bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center shrink-0 border border-blue-500/20 shadow-inner">
              <Activity size={28} />
            </div>
            <div>
              <h3 className="text-lg md:text-xl font-bold text-white tracking-tight">System Status</h3>
              <p className="text-sm md:text-base text-slate-400 mt-2.5 leading-relaxed">
                All PIPELIXR cloud infrastructure is operational. Messaging synchronization architecture runs in real-time.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
