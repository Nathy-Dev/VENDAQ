"use client";

import React, { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import DashboardNavbar from "@/components/DashboardNavbar";
import StatusViewer from "@/components/StatusViewer";

export default function StatusPage() {
  const { data: session } = useSession();
  const [, setSelectedPhone] = useState<string | null>(null);

  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  const handleSelectCustomer = async (phone: string) => {
    // Placeholder for upcoming "retarget/send automation" flow.
    setSelectedPhone(phone);
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
