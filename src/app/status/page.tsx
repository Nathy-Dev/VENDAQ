"use client";

import React, { useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import DashboardNavbar from "@/components/DashboardNavbar";
import StatusViewer from "@/components/StatusViewer";
import { Id } from "../../../convex/_generated/dataModel";
import styles from "../dashboard/dashboard.module.css";
import shellStyles from "@/components/DashboardShell.module.css";

export default function StatusPage() {
  const { data: session } = useSession();
  const [, setSelectedPhone] = useState<string | null>(null);
  const openChatFromViewer = useMutation(api.whatsapp.openChatFromViewer);

  const business = useQuery(
    api.businesses.getBusiness,
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  const handleSelectCustomer = async (phone: string) => {
    setSelectedPhone(phone);
    if (!business) return;
    const result = await openChatFromViewer({
      businessId: business._id as Id<"businesses">,
      viewerPhone: phone,
    });
    window.open(result.deepLink, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <DashboardNavbar />
      <main className={shellStyles.main}>
        <div className={shellStyles.content}>
          {business ? (
            <StatusViewer
              businessId={business._id}
              onSelectCustomer={handleSelectCustomer}
            />
          ) : (
            <div className={styles.connectBanner}>
              <div className={styles.connectInfo}>
                <h3 className={styles.connectTitle}>Set up your business first</h3>
                <p className={styles.connectDesc}>
                  Complete onboarding to track who viewed your WhatsApp status.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
