"use client";

import React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Doc, Id } from "../../convex/_generated/dataModel";
import { Eye, MessageSquare, Clock, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import styles from "./StatusViewer.module.css";
import Image from "next/image";

interface StatusViewerProps {
  businessId: string;
  onSelectCustomer: (phone: string) => Promise<void> | void;
}

export default function StatusViewer({ businessId, onSelectCustomer }: StatusViewerProps) {
  const seedTemplates = useMutation(api.whatsapp.seedDefaultTemplates);
  const createRun = useMutation(api.whatsapp.createAutomationRun);
  const executeRun = useAction(api.whatsapp.executeAutomationRun);
  const templates = useQuery(api.whatsapp.getMessageTemplates, { businessId: businessId as Id<"businesses"> }) as Array<{ _id: Id<"messageTemplates"> }> | undefined;
  const [segment, setSegment] = React.useState("viewed_not_replied");

  React.useEffect(() => {
    if (templates !== undefined && templates.length === 0) {
      void seedTemplates({ businessId: businessId as Id<"businesses"> });
    }
  }, [templates, seedTemplates, businessId]);

  const runSegmentRetarget = async () => {
    if (!templates || templates.length === 0) return;
    const runId = await createRun({
      businessId: businessId as Id<"businesses">,
      segment,
      templateId: templates[0]._id,
      mode: "manual",
    });
    await executeRun({ businessId: businessId as Id<"businesses">, runId });
  };

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
        <div className={styles.segmentTools}>
          <select className={styles.segmentSelect} value={segment} onChange={(e) => setSegment(e.target.value)}>
            <option value="viewed_not_replied">Viewed, not replied</option>
            <option value="replied_not_ordered">Replied, not ordered</option>
            <option value="ordered_not_paid">Ordered, not paid</option>
            <option value="paid_cross_sell_candidate">Paid, cross-sell candidate</option>
          </select>
          <button className={styles.retargetBtn} onClick={runSegmentRetarget} disabled={!templates || templates.length === 0}>
            <Zap size={16} />
            <span>Run Segment</span>
          </button>
        </div>
      </header>

      <div className={styles.statusGrid}>
        {statuses.map((status: Doc<"statuses">) => (
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

type StatusViewDoc = Doc<"statusViews">;

function StatusCard({ status, businessId, onSelectCustomer }: { status: Doc<"statuses">, businessId: string, onSelectCustomer: (phone: string) => Promise<void> | void }) {
  const retargetViewers = useMutation(api.whatsapp.bulkRetargetViewers);
  const views = useQuery(api.whatsapp.getStatusViews, { 
    businessId: businessId as Id<"businesses">, 
    whatsappStatusId: status.whatsappMessageId || "" 
  });
  
  const mediaUrl = useQuery(api.interactions.getMediaUrl, status.mediaId ? { mediaId: status.mediaId } : "skip");
  const templates = useQuery(api.whatsapp.getMessageTemplates, { businessId: businessId as Id<"businesses"> }) as Array<{ _id: Id<"messageTemplates"> }> | undefined;

  const handleRetarget = async () => {
    if (!templates || templates.length === 0 || !views || views.length === 0) return;
    await retargetViewers({
      businessId: businessId as Id<"businesses">,
      templateId: templates[0]._id as Id<"messageTemplates">,
      viewerPhones: views.map((view: StatusViewDoc) => view.viewerPhone),
      hours: 24,
    });
  };

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
            views.slice(0, 5).map((view: StatusViewDoc) => (
              <div key={view._id} className={styles.viewerItem}>
                <span className={styles.viewerPhone}>{view.viewerPhone.split('@')[0]}</span>
                <button
                  className={styles.convertBtn}
                  onClick={() => onSelectCustomer(view.viewerPhone)}
                  title="Open Chat"
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
        
        <button className={styles.retargetBtn} onClick={handleRetarget} disabled={!views || views.length === 0 || !templates || templates.length === 0}>
            <Zap size={16} />
            <span>Retarget All Viewers</span>
        </button>
      </div>
    </div>
  );
}
