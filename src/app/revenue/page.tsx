"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Loader from "@/components/Loader";
import RevenueWorkspace from "@/components/RevenueWorkspace";
import DashboardNavbar from "@/components/DashboardNavbar";
import styles from "../dashboard/dashboard.module.css";
import shellStyles from "@/components/DashboardShell.module.css";

export default function RevenuePage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();

  const business = useQuery(
    api.businesses.getBusiness,
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  useEffect(() => {
    if (sessionStatus === "unauthenticated") {
      router.push("/login");
    }
  }, [sessionStatus, router]);

  const isBusinessLoading = sessionStatus === "authenticated" && session?.user?.id && business === undefined;
  if (sessionStatus === "loading" || isBusinessLoading) return <Loader />;
  if (sessionStatus === "unauthenticated") return null;

  return (
    <>
      <DashboardNavbar />
      <main className={shellStyles.main}>
        <div className={shellStyles.content}>
          <header className={styles.header}>
            <div>
              <h1 className={styles.welcomeTitle}>Send Actions</h1>
              <p className={styles.subTitle}>Message your best leads with one tap. The AI writes it, you approve it.</p>
            </div>
          </header>
          {business ? (
            <RevenueWorkspace businessId={business._id} />
          ) : (
            <div className={styles.connectBanner}>
              <div className={styles.connectInfo}>
                <h3 className={styles.connectTitle}>Set up your business first</h3>
                <p className={styles.connectDesc}>Complete onboarding to unlock the revenue workspace.</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
