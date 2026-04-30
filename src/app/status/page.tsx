"use client";

import React, { useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import DashboardNavbar from "@/components/DashboardNavbar";
import StatusViewer from "@/components/StatusViewer";
import { Id } from "../../../convex/_generated/dataModel";

export default function StatusPage() {
  const { data: session } = useSession();
  const [, setSelectedPhone] = useState<string | null>(null);
  const openChatFromViewer = useMutation(api.whatsapp.openChatFromViewer);

  const business = useQuery(api.businesses.getBusiness, 
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
    <main style={{ minHeight: '100vh', backgroundColor: '#0f172a' }}>
      <DashboardNavbar />
      
      <div style={{ paddingTop: '80px' }}>
        {business ? (
          <StatusViewer 
            businessId={business._id} 
            onSelectCustomer={handleSelectCustomer} 
          />
        ) : (
          <div style={{ padding: '4rem', textAlign: 'center', color: '#8696a0' }}>
            Loading your business data...
          </div>
        )}
      </div>
    </main>
  );
}
