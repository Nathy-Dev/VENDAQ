"use client";

import React from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Eye, MessageSquare, Clock, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import styles from "./StatusViewer.module.css";
import Image from "next/image";

interface StatusViewerProps {
  businessId: string;
  onSelectCustomer: (phone: string) => void;
}

export default function StatusViewer({ businessId, onSelectCustomer }: StatusViewerProps) {
  const statuses = useQuery(api.whatsapp.getStatuses, { 
    businessId: businessId as Id<"businesses"> 
  });

  if (!statuses) {
    return <div className={styles.loading}>Loading active statuses...</div>;
  }

  if (statuses.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Zap size={48} className={styles.emptyIcon} />
        <h3>No active statuses</h3>
        <p>Post a status on WhatsApp to see your viewers and convert them to leads.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h2 className={styles.title}>Status-to-Cash Engine</h2>
        <p className={styles.subtitle}>Track your status viewers and turn them into paying customers.</p>
      </header>

      <div className={styles.statusGrid}>
        {statuses.map((status) => (
          <StatusCard 
            key={status._id} 
            status={status} 
            businessId={businessId} 
            onSelectCustomer={onSelectCustomer}
          />
        ))}
      </div>
    </div>
  );
}

function StatusCard({ status, businessId, onSelectCustomer }: { status: any, businessId: string, onSelectCustomer: (phone: string) => void }) {
  const views = useQuery(api.whatsapp.getStatusViews, { 
    businessId: businessId as Id<"businesses">, 
    whatsappStatusId: status.whatsappMessageId || "" 
  });
  
  const mediaUrl = useQuery(api.interactions.getMediaUrl, status.mediaId ? { mediaId: status.mediaId } : "skip");

  return (
    <div className={styles.card}>
      <div className={styles.statusPreview}>
        {status.mediaType === "image" && mediaUrl ? (
          <Image src={mediaUrl} alt="Status" fill className={styles.previewImage} unoptimized />
        ) : (
          <div className={styles.textStatus}>{status.content || "Media Status"}</div>
        )}
        <div className={styles.viewCount}>
          <Eye size={16} />
          <span>{views?.length || 0}</span>
        </div>
      </div>
      
      <div className={styles.cardContent}>
        <div className={styles.statusMeta}>
          <Clock size={14} />
          <span>{formatDistanceToNow(status.timestamp)} ago</span>
        </div>
        
        <div className={styles.viewersList}>
          <h4 className={styles.viewerHeading}>Recent Viewers</h4>
          {views && views.length > 0 ? (
            views.slice(0, 5).map((view: any) => (
              <div key={view._id} className={styles.viewerItem}>
                <span className={styles.viewerPhone}>{view.viewerPhone.split('@')[0]}</span>
                <button 
                  className={styles.convertBtn}
                  onClick={() => onSelectCustomer(view.viewerPhone)}
                  title="Send Message"
                >
                  <MessageSquare size={14} />
                </button>
              </div>
            ))
          ) : (
            <div className={styles.noViewers}>No viewers tracked yet</div>
          )}
          {views && views.length > 5 && (
            <div className={styles.moreViewers}>+{views.length - 5} more</div>
          )}
        </div>
        
        <button className={styles.retargetBtn}>
            <Zap size={16} />
            <span>Retarget All Viewers</span>
        </button>
      </div>
    </div>
  );
}
