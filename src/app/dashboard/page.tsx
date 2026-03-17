"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { LayoutDashboard, MessageSquare, Users, TrendingUp } from "lucide-react";

export default function DashboardPage() {
  const { data: session } = useSession();

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Welcome back, {session?.user?.name || "Partner"}!</h1>
            <p className="text-slate-400">Here's what's happening with VENDAQ today.</p>
          </div>
          <Link href="/" className="text-emerald-500 hover:text-emerald-400 font-medium">
            View Landing Page
          </Link>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCard icon={MessageSquare} label="New Inquiries" value="12" color="bg-blue-500/10 text-blue-500" />
          <StatCard icon={Users} label="Total Customers" value="148" color="bg-emerald-500/10 text-emerald-500" />
          <StatCard icon={TrendingUp} label="Weekly Revenue" value="₦45,000" color="bg-purple-500/10 text-purple-500" />
          <StatCard icon={LayoutDashboard} label="Active Pipeline" value="8" color="bg-amber-500/10 text-amber-500" />
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-12 text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <LayoutDashboard size={32} />
          </div>
          <h2 className="text-2xl font-bold">Your Dashboard is ready!</h2>
          <p className="text-slate-400 max-w-md mx-auto">
            This is where your WhatsApp sales will be organized. We're currently setting up your real-time data sync.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: any) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-2">
      <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center mb-2`}>
        <Icon size={20} />
      </div>
      <div className="text-slate-400 text-sm">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
