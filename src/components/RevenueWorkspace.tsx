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
      {/* ── Stats strip ── */}
      <div className={styles.metrics}>
        <MetricCard label="Messages Sent" value={(metrics?.totalSent || 0).toString()} />
        <MetricCard label="Replied Back" value={`${Math.round((metrics?.replyRate || 0) * 100)}%`} />
        <MetricCard label="Deals Closed" value={`${Math.round((metrics?.winRate || 0) * 100)}%`} />
        <MetricCard label="Revenue Recovered" value={`NGN ${(metrics?.recoveredRevenue || 0).toLocaleString()}`} />
      </div>

      {/* ── Who to message ── */}
      <InvisibleCrmPanel businessId={businessId} />

      {/* ── Deal outcomes ── */}
      <section className={styles.outcomes}>
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <h3 className={styles.heading}>Deal Results</h3>
          <p className={styles.subheading}>Mark each deal as won or lost so the AI learns what works for your business.</p>
        </div>

        {!outcomes ? (
          <div className={styles.empty}>Loading your deals…</div>
        ) : outcomes.length === 0 ? (
          <div className={styles.empty}>No deals to review yet. Send messages from above to get started.</div>
        ) : (
          <div className={styles.list}>
            {outcomes.map((outcome) => (
              <article className={styles.item} key={outcome._id}>
                <div>
                  <div className={styles.customer}>{outcome.customerName}</div>
                  <div className={styles.message}>{outcome.suggestedMessage}</div>
                  <div className={styles.meta}>
                    Status: <strong style={{ color: "#e9eef6" }}>{outcome.status}</strong> · Est. NGN {outcome.estimatedValue.toLocaleString()}
                  </div>
                </div>
                {(outcome.status === "sent" || outcome.status === "replied") && (
                  <div className={styles.actions}>
                    <button className={styles.winBtn} onClick={() => closeOutcome(outcome._id, "won", outcome.estimatedValue)}>✓ Won</button>
                    <button className={styles.lostBtn} onClick={() => closeOutcome(outcome._id, "lost", outcome.estimatedValue)}>✗ Lost</button>
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
