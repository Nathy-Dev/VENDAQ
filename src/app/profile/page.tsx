"use client";

import { useSession } from "next-auth/react";
import { User, Mail, Shield, Building, Edit3, Smartphone, Activity } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";

export default function ProfilePage() {
  const { data: session } = useSession();
  
  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );
  
  return (
    <div className="p-8 max-w-4xl mx-auto text-slate-200">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Your Profile</h1>
          <p className="text-slate-400 mt-1">Manage your personal and business details here.</p>
        </div>
        <Link href="/settings" className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold py-2 px-4 rounded-xl border border-slate-700 transition-colors">
          <Edit3 size={16} /> Edit Profile
        </Link>
      </div>
      
      {/* Main Profile Card */}
      <div className="bg-[#0f172a]/60 backdrop-blur-md rounded-2xl border border-slate-800 overflow-hidden shadow-xl mb-8">
        {/* Banner */}
        <div className="h-32 relative bg-gradient-to-r from-emerald-600/20 via-blue-600/20 to-purple-600/20 border-b border-slate-800/50">
          <div className="absolute -bottom-12 left-8">
            <div className="w-24 h-24 rounded-full bg-slate-900 border-4 border-[#0f172a] shadow-lg flex items-center justify-center text-emerald-500 text-4xl font-bold">
              {session?.user?.name?.[0]?.toUpperCase() || "U"}
            </div>
          </div>
        </div>
        
        <div className="pt-16 pb-8 px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
            
            {/* Personal Details */}
            <div className="space-y-6 bg-slate-800/20 p-6 rounded-xl border border-slate-800/50">
              <h2 className="text-sm font-bold text-emerald-500 uppercase tracking-widest mb-4">Personal Info</h2>
              
              <div className="space-y-4">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-2 uppercase tracking-wide">
                  <User size={14} /> Full Name
                </label>
                <p className="text-lg text-slate-200 font-semibold border-b border-slate-800 pb-2">
                  {session?.user?.name || "Loading..."}
                </p>
              </div>
              
              <div className="space-y-4">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-2 uppercase tracking-wide">
                  <Mail size={14} /> Email Address
                </label>
                <p className="text-lg text-slate-200 font-semibold border-b border-slate-800 pb-2">
                  {session?.user?.email || "Loading..."}
                </p>
              </div>
            </div>

            {/* Business Details */}
            <div className="space-y-6 bg-slate-800/20 p-6 rounded-xl border border-slate-800/50">
              <h2 className="text-sm font-bold text-blue-500 uppercase tracking-widest mb-4">Business Info</h2>
              
              <div className="space-y-4">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-2 uppercase tracking-wide">
                  <Building size={14} /> Business Name
                </label>
                <p className="text-lg text-slate-200 font-semibold border-b border-slate-800 pb-2 flex items-center gap-2">
                  {business ? business.name : "Loading..."}
                </p>
              </div>
              
              <div className="space-y-4">
                <label className="text-xs font-medium text-slate-500 flex items-center gap-2 uppercase tracking-wide">
                  <Smartphone size={14} /> WhatsApp Status
                </label>
                <div className="border-b border-slate-800 pb-2">
                  {business?.whatsappStatus === "connected" ? (
                    <span className="inline-flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full text-sm font-bold border border-emerald-500/20">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 bg-red-500/10 text-red-400 px-3 py-1 rounded-full text-sm font-bold border border-red-500/20">
                      <span className="w-2 h-2 rounded-full bg-red-500"></span> Disconnected
                    </span>
                  )}
                </div>
              </div>

            </div>
            
          </div>
        </div>
      </div>
      
      {/* System Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#0f172a]/60 backdrop-blur-md p-6 rounded-xl border border-slate-800 shadow-sm flex items-start gap-4 hover:border-emerald-500/30 transition-colors">
          <div className="w-12 h-12 bg-emerald-500/10 text-emerald-500 rounded-xl flex items-center justify-center shrink-0">
            <Shield size={22} />
          </div>
          <div>
            <h3 className="font-bold text-slate-200">Account Security</h3>
            <p className="text-sm text-slate-400 mt-1 leading-relaxed">Your account is secured with OAuth integration. No password changes required here.</p>
          </div>
        </div>
        
        <div className="bg-[#0f172a]/60 backdrop-blur-md p-6 rounded-xl border border-slate-800 shadow-sm flex items-start gap-4 hover:border-blue-500/30 transition-colors">
          <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-xl flex items-center justify-center shrink-0">
            <Activity size={22} />
          </div>
          <div>
            <h3 className="font-bold text-slate-200">System Status</h3>
            <p className="text-sm text-slate-400 mt-1 leading-relaxed">All PIPELIXR services are operational. Your WhatsApp sync is active and healthy.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
