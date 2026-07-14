"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Loader from "@/components/Loader";
import PipelineBoard from "@/components/PipelineBoard";
import DashboardNavbar from "@/components/DashboardNavbar";
import styles from "../dashboard/dashboard.module.css";

export default function PipelinePage() {
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

  const isBusinessLoading =
    sessionStatus === "authenticated" && session?.user?.id && business === undefined;
  if (sessionStatus === "loading" || isBusinessLoading) return <Loader />;
  if (sessionStatus === "unauthenticated") return null;

  return (
    <>
      <DashboardNavbar />
      <div className={styles.container}>
        <div className={styles.wrapper}>
          {business ? (
            <PipelineBoard businessId={business._id} />
          ) : (
            <div className={styles.connectBanner}>
              <div className={styles.connectInfo}>
                <h3 className={styles.connectTitle}>Set up your business first</h3>
                <p className={styles.connectDesc}>
                  Complete onboarding to see your revenue pipeline.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
