"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";


import { api } from "../../../convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LayoutDashboard, MessageSquare, Users, TrendingUp, ChevronRight, type LucideIcon } from "lucide-react";
import styles from "./dashboard.module.css";
import Loader from "@/components/Loader";


export default function DashboardPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();

  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  useEffect(() => {
    if (sessionStatus === "authenticated" && business !== undefined) {
      if (!business) {
        router.push("/onboarding");
      } else if (business.whatsappStatus === "disconnected") {
        router.push("/onboarding/connect");
      }
    } else if (sessionStatus === "unauthenticated") {
      router.push("/login");
    }
  }, [sessionStatus, business, router]);

  if (sessionStatus === "loading" || (sessionStatus === "authenticated" && business === undefined)) {
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
            <p className={styles.subTitle}>Here&apos;s what&apos;s happening with VENDAQ today.</p>
          </div>
          <Link href="/" className={styles.landingLink}>
            View Landing Page
          </Link>
        </header>

        <div className={styles.statsGrid}>
          <StatCard 
            icon={MessageSquare} 
            label="New Inquiries" 
            value="12" 
            color="rgba(59, 130, 246, 0.1)" 
            iconColor="#3b82f6" 
          />
          <StatCard 
            icon={Users} 
            label="Total Customers" 
            value="148" 
            color="rgba(16, 185, 129, 0.1)" 
            iconColor="#10b981" 
          />
          <StatCard 
            icon={TrendingUp} 
            label="Weekly Revenue" 
            value="₦45,000" 
            color="rgba(139, 92, 246, 0.1)" 
            iconColor="#8b5cf6" 
          />
          <StatCard 
            icon={LayoutDashboard} 
            label="Active Pipeline" 
            value="8" 
            color="rgba(245, 158, 11, 0.1)" 
            iconColor="#f59e0b" 
          />
        </div>

        <main className={styles.mainSection}>
          <div className={styles.mainIconWrapper}>
            <LayoutDashboard size={36} />
          </div>
          <h2 className={styles.mainTitle}>Your Dashboard is ready!</h2>
          <p className={styles.mainDesc}>
            This is where your WhatsApp sales will be organized. We&apos;re currently 
            setting up your real-time data sync with your WhatsApp messages.
          </p>
          <button className={styles.actionButton}>
            Get Started with Pipeline <ChevronRight size={18} style={{ display: 'inline', marginLeft: '4px' }} />
          </button>
        </main>
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
