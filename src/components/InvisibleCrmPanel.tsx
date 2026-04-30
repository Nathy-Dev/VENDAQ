"use client";

import React from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { InvisibleCrmOverview, RevenueActionItem } from "@/types";
import { AlertTriangle, Send, TrendingUp } from "lucide-react";
import styles from "./InvisibleCrmPanel.module.css";

interface InvisibleCrmPanelProps {
  businessId: Id<"businesses">;
}

export default function InvisibleCrmPanel({ businessId }: InvisibleCrmPanelProps) {
  const overview = useQuery(api.whatsapp.getInvisibleCrmOverview, { businessId }) as InvisibleCrmOverview | undefined;
  const actions = useQuery(api.whatsapp.getRevenueActionFeed, { businessId, limit: 12 }) as RevenueActionItem[] | undefined;
  const executeRevenueAction = useAction(api.whatsapp.executeRevenueAction);
  const [sendingId, setSendingId] = React.useState<string | null>(null);

  const sendNow = async (item: RevenueActionItem) => {
    setSendingId(item.customerId);
    try {
      await executeRevenueAction({
        businessId,
        customerId: item.customerId,
        message: item.suggestedMessage,
      });
    } finally {
      setSendingId(null);
    }
  };

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>Revenue Action Feed</h3>
          <p className={styles.subtitle}>No CRM admin. Just the next messages most likely to close.</p>
        </div>
      </header>

      <div className={styles.kpis}>
        <Kpi label="Hot Leads" value={overview?.hotLeads ?? 0} icon={<TrendingUp size={14} />} />
        <Kpi label="Stalled After Quote" value={overview?.stalledAfterQuote ?? 0} icon={<AlertTriangle size={14} />} />
        <Kpi label="Potential Revenue At Risk" value={`NGN ${(overview?.potentialRevenueAtRisk ?? 0).toLocaleString()}`} icon={<TrendingUp size={14} />} />
      </div>

      <div className={styles.feed}>
        {!actions ? (
          <div className={styles.empty}>Preparing action feed...</div>
        ) : actions.length === 0 ? (
          <div className={styles.empty}>No urgent actions right now.</div>
        ) : (
          actions.map((item) => (
            <article className={styles.item} key={item.customerId}>
              <div className={styles.itemHeader}>
                <div>
                  <div className={styles.customer}>{item.customerName}</div>
                  <div className={styles.reason}>{item.reason}</div>
                </div>
                <span className={`${styles.priority} ${styles[item.priority]}`}>{item.priority}</span>
              </div>

              <div className={styles.message}>{item.suggestedMessage}</div>

              <div className={styles.itemFooter}>
                <span className={styles.value}>Est. value: NGN {item.estimatedValue.toLocaleString()}</span>
                <button
                  className={styles.sendBtn}
                  onClick={() => sendNow(item)}
                  disabled={sendingId === item.customerId}
                >
                  <Send size={13} />
                  <span>{sendingId === item.customerId ? "Sending..." : "Send Now"}</span>
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>
        {icon}
        <span>{label}</span>
      </div>
      <div className={styles.kpiValue}>{value}</div>
    </div>
  );
}
