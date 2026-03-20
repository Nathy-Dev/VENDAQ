"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LayoutDashboard, MessageSquare, Users, TrendingUp, type LucideIcon } from "lucide-react";
import styles from "./dashboard.module.css";
import Loader from "@/components/Loader";
import LeadPipeline from "@/components/LeadPipeline";
import { ChatThread, PooledOrders } from "@/types";


export default function DashboardPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();

  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  const chats = useQuery(api.interactions.getRecentChats,
    business ? { businessId: business._id } : "skip"
  ) as ChatThread[] | undefined;

  const orders = useQuery(api.orders.getOrdersByBusiness,
    business ? { businessId: business._id } : "skip"
  ) as PooledOrders | undefined;


  useEffect(() => {
    if (sessionStatus === "unauthenticated") {
      router.push("/login");
    }
  }, [sessionStatus, router]);


  const isBusinessLoading = sessionStatus === "authenticated" && session?.user?.id && business === undefined;

  if (sessionStatus === "loading" || isBusinessLoading) {
    return <Loader />;
  }

  if (sessionStatus === "unauthenticated") {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.wrapper}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.welcomeTitle}>Welcome back, {session?.user?.name || "Partner"}!</h1>
            <p className={styles.subTitle}>Here&apos;s what&apos;s happening with MERXAGE today.</p>
          </div>
        </header>

        <div className={styles.statsGrid}>
          <StatCard 
            icon={MessageSquare} 
            label="Daily Inquiries" 
            value={chats?.length.toString() || "0"} 
            color="rgba(59, 130, 246, 0.1)" 
            iconColor="#3b82f6" 
          />
          <StatCard 
            icon={Users} 
            label="Customers" 
            value={chats?.length.toString() || "0"} 
            color="rgba(16, 185, 129, 0.1)" 
            iconColor="#10b981" 
          />
          <StatCard 
            icon={TrendingUp} 
            label="Weekly Revenue" 
            value="₦0" 
            color="rgba(139, 92, 246, 0.1)" 
            iconColor="#8b5cf6" 
          />
          <StatCard 
            icon={LayoutDashboard} 
            label="Active Pipeline" 
            value={((orders?.pending.length || 0) + (orders?.awaiting_payment.length || 0)).toString()} 
            color="rgba(245, 158, 11, 0.1)" 
            iconColor="#f59e0b" 
          />
        </div>

        {(!business || business.whatsappStatus !== "connected") && (
          <div className={styles.connectBanner}>
            <div className={styles.connectInfo}>
              <h3 className={styles.connectTitle}>
                {!business ? "Welcome to MERXAGE! Connect your WhatsApp" : business.whatsappStatus === "error" ? "Connection Error" : "WhatsApp Not Connected"}
              </h3>
              <p className={styles.connectDesc}>
                {!business 
                  ? "Finalize your setup to start capturing leads and managing your pipeline automatically."
                  : "Reconnect your WhatsApp to continue syncing your messages and leads."}
              </p>
            </div>
            <button 
              onClick={() => router.push("/onboarding")}
              className={styles.connectButton}
            >
              Get Started
            </button>
          </div>
        )}


        <div className={styles.dashboardGrid}>
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest px-1">Lead Pipeline</h3>
              {business?.whatsappStatus === "connected" && (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded-full font-bold">LIVE SYNC ACTIVE</span>
              )}
            </div>
            <LeadPipeline orders={orders} isLoading={orders === undefined} />
          </div>
        </div>


      </div>
    </div>
  );
}


interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  color: string;
  iconColor: string;
}

function StatCard({ icon: Icon, label, value, color, iconColor }: StatCardProps) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statIconWrapper} style={{ backgroundColor: color, color: iconColor }}>
        <Icon size={22} />
      </div>
      <div>
        <div className={styles.statLabel}>{label}</div>
        <div className={styles.statValue}>{value}</div>
      </div>
    </div>
  );
}
