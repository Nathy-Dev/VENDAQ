"use client";

import React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { ActionOutcome, RevenueLoopMetrics } from "@/types";
import InvisibleCrmPanel from "./InvisibleCrmPanel";
import styles from "./RevenueWorkspace.module.css";

interface RevenueWorkspaceProps {
  businessId: Id<"businesses">;
}

export default function RevenueWorkspace({ businessId }: RevenueWorkspaceProps) {
  const metrics = useQuery(api.whatsapp.getRevenueLoopMetrics, { businessId }) as RevenueLoopMetrics | undefined;
  const outcomes = useQuery(api.whatsapp.getRecentActionOutcomes, { businessId, limit: 20 }) as ActionOutcome[] | undefined;
  const markClosed = useMutation(api.whatsapp.markActionOutcomeClosed);

  const closeOutcome = async (outcomeId: Id<"actionOutcomes">, status: "won" | "lost", estimatedValue: number) => {
    await markClosed({
      businessId,
      outcomeId,
      status,
      outcomeValue: status === "won" ? estimatedValue : 0,
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.metrics}>
        <MetricCard label="Actions Sent" value={(metrics?.totalSent || 0).toString()} />
        <MetricCard label="Reply Rate" value={`${Math.round((metrics?.replyRate || 0) * 100)}%`} />
        <MetricCard label="Win Rate" value={`${Math.round((metrics?.winRate || 0) * 100)}%`} />
        <MetricCard label="Recovered Revenue" value={`NGN ${(metrics?.recoveredRevenue || 0).toLocaleString()}`} />
      </div>

      <InvisibleCrmPanel businessId={businessId} />

      <section className={styles.outcomes}>
        <h3 className={styles.heading}>Action Outcomes</h3>
        <p className={styles.subheading}>Mark outcomes so scoring learns what closes for this business.</p>

        {!outcomes ? (
          <div className={styles.empty}>Loading outcomes...</div>
        ) : outcomes.length === 0 ? (
          <div className={styles.empty}>No outcomes yet. Send actions from the feed to start learning.</div>
        ) : (
          <div className={styles.list}>
            {outcomes.map((outcome) => (
              <article className={styles.item} key={outcome._id}>
                <div>
                  <div className={styles.customer}>{outcome.customerName}</div>
                  <div className={styles.message}>{outcome.suggestedMessage}</div>
                  <div className={styles.meta}>
                    Status: <strong>{outcome.status}</strong> | Est. NGN {outcome.estimatedValue.toLocaleString()}
                  </div>
                </div>
                {(outcome.status === "sent" || outcome.status === "replied") && (
                  <div className={styles.actions}>
                    <button className={styles.winBtn} onClick={() => closeOutcome(outcome._id, "won", outcome.estimatedValue)}>Mark Won</button>
                    <button className={styles.lostBtn} onClick={() => closeOutcome(outcome._id, "lost", outcome.estimatedValue)}>Mark Lost</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricValue}>{value}</div>
    </div>
  );
}
