"use client";

import React, { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import DashboardNavbar from "@/components/DashboardNavbar";
import StatusViewer from "@/components/StatusViewer";
import MessageThread from "@/components/MessageThread";
import { ChatThread } from "@/types";
import { X } from "lucide-react";

export default function StatusPage() {
  const { data: session } = useSession();
  const [selectedChat, setSelectedChat] = useState<ChatThread | null>(null);

  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  const handleSelectCustomer = async (phone: string) => {
    if (!business) return;
    
    // We need to find the customer object for this phone
    // For now, we'll just trigger the MessageInbox via the Navbar (conceptual)
    // But better: we query the customer directly here.
    alert(`Opening chat for ${phone}. This will open the message thread.`);
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

      {selectedChat && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(2, 6, 23, 0.95)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column'
        }}>
            <div style={{
                padding: '1rem',
                display: 'flex',
                justifyContent: 'flex-end',
                borderBottom: '1px solid #1e293b'
            }}>
                <button onClick={() => setSelectedChat(null)} style={{ color: '#94a3b8' }}>
                    <X size={32} />
                </button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
                <MessageThread 
                    chat={selectedChat} 
                    businessId={business?._id || ""} 
                    onBack={() => setSelectedChat(null)} 
                />
            </div>
        </div>
      )}
    </main>
  );
}
