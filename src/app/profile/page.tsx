"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSession } from "next-auth/react";
import { User, Mail, Shield, Building } from "lucide-react";

export default function ProfilePage() {
  const { data: session } = useSession();
  
  // Assuming we have a way to get the user from Convex based on email
  // For now, we'll just show the session info or a placeholder
  
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-slate-800">Your Profile</h1>
      
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="bg-blue-600 h-32 relative">
          <div className="absolute -bottom-12 left-8">
            <div className="w-24 h-24 rounded-full bg-white border-4 border-white shadow-md flex items-center justify-center text-blue-600 text-4xl font-bold">
              {session?.user?.name?.[0] || "U"}
            </div>
          </div>
        </div>
        
        <div className="pt-16 pb-8 px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
            <div className="space-y-4">
              <label className="text-sm font-medium text-slate-500 flex items-center gap-2 uppercase tracking-wider">
                <User size={16} /> Full Name
              </label>
              <p className="text-lg text-slate-800 font-semibold border-b border-slate-50 pb-2">
                {session?.user?.name || "Loading..."}
              </p>
            </div>
            
            <div className="space-y-4">
              <label className="text-sm font-medium text-slate-500 flex items-center gap-2 uppercase tracking-wider">
                <Mail size={16} /> Email Address
              </label>
              <p className="text-lg text-slate-800 font-semibold border-b border-slate-50 pb-2">
                {session?.user?.email || "Loading..."}
              </p>
            </div>
          </div>
        </div>
      </div>
      
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm">
          <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center mb-4">
            <Shield size={20} />
          </div>
          <h3 className="font-semibold text-slate-800">Account Security</h3>
          <p className="text-sm text-slate-500 mt-2">Enhanced protection enabled on your account.</p>
        </div>
        
        <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm">
          <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-lg flex items-center justify-center mb-4">
            <Building size={20} />
          </div>
          <h3 className="font-semibold text-slate-800">Business Context</h3>
          <p className="text-sm text-slate-500 mt-2">Managing your enterprise workspace.</p>
        </div>
      </div>
    </div>
  );
}
