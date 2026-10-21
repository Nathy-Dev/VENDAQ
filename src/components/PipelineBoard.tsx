"use client";

import React, { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Flame, Snowflake, Clock, ChevronRight } from "lucide-react";
import styles from "./PipelineBoard.module.css";

interface Props {
  businessId: Id<"businesses">;
}

export default function PipelineBoard({ businessId }: Props) {
  const [period, setPeriod] = useState<"today" | "week" | "month">("week");

  const funnelMetrics = useQuery(api.pipeline.getFullFunnelMetrics, {
    businessId,
    period,
  });

  const board = useQuery(api.pipeline.getPriorityBoard, { businessId });

  if (!funnelMetrics || !board) {
    return <div className={styles.loading}>Loading your pipeline…</div>;
  }

  const { funnel, conversions, recovery } = funnelMetrics;

  return (
    <div className={styles.container}>
      {/* ── Header + Period Toggle ── */}
      <div className={styles.headerRow}>
        <div>
          <h2 className={styles.pageTitle}>Your Sales Journey</h2>
          <p className={styles.pageSubtitle}>
            See how people move from seeing your status to paying you money.
          </p>
        </div>
        <div className={styles.periodToggle}>
          {(["today", "week", "month"] as const).map((p) => (
            <button
              key={p}
              className={`${styles.periodBtn} ${period === p ? styles.periodBtnActive : ""}`}
              onClick={() => setPeriod(p)}
            >
              {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Sales Funnel ── */}
      <section className={styles.funnelSection}>
        <h3 className={styles.sectionTitle}>From Viewer to Buyer</h3>
        <div className={styles.funnelSteps}>
          <FunnelStep label="Statuses Posted" value={funnel.statusesPosted} />
          <Arrow />
          <FunnelStep label="People Who Saw It" value={funnel.totalViews} />
          <Arrow conversion={conversions.viewToConversation} />
          <FunnelStep label="Messaged You" value={funnel.dmsStarted} />
          <Arrow conversion={conversions.conversationToOrder} />
          <FunnelStep label="Placed an Order" value={funnel.ordersCreated} />
          <Arrow conversion={conversions.orderToPayment} />
          <FunnelStep label="Paid" value={funnel.paymentsClosed} />
          <Arrow />
          <FunnelStep
            label="Revenue"
            value={`₦${funnel.revenue.toLocaleString()}`}
            isRevenue
          />
        </div>
      </section>

      {/* ── What the AI recovered ── */}
      <section className={styles.funnelSection}>
        <h3 className={styles.sectionTitle}>What the AI Did For You</h3>
        <p className={styles.sectionSubtitle}>Money and leads recovered automatically — no manual work needed.</p>
        <div className={styles.recoveryGrid}>
          <RecoveryCard
            label="Revenue Recovered"
            value={`₦${recovery.revenueRecovered.toLocaleString()}`}
            variant="green"
          />
          <RecoveryCard
            label="Leads Converted"
            value={recovery.leadsConverted.toString()}
            variant="green"
          />
          <RecoveryCard
            label="Follow-ups Sent"
            value={recovery.followUpsSent.toString()}
          />
          <RecoveryCard
            label="Still at Risk"
            value={`₦${recovery.missedMoney.toLocaleString()}`}
            variant="red"
          />
        </div>
      </section>

      {/* ── Who needs attention ── */}
      <section>
        <h3 className={styles.sectionTitle}>Who Needs Your Attention</h3>
        <div className={styles.boardGrid}>
          {/* HOT — Ready to Buy */}
          <div className={styles.boardColumn}>
            <div className={styles.boardColumnHeader}>
              <Flame size={15} style={{ color: "#f87171" }} />
              <span className={styles.boardColumnTitle}>Ready to Buy</span>
              <span className={styles.boardColumnCount}>{board.summary.hotCount}</span>
            </div>
            {board.hotLeads.length === 0 ? (
              <div className={styles.empty}>No one here right now</div>
            ) : (
              board.hotLeads.map((lead) => (
                <div key={lead.customerId} className={styles.leadCard}>
                  <div className={styles.leadName}>{lead.name}</div>
                  <div className={styles.leadPhone}>{lead.phone.split("@")[0]}</div>
                  <div className={styles.leadReason}>{lead.reason}</div>
                  <div className={styles.leadMeta}>
                    Silent for {lead.hoursSilent}h · {lead.funnelStage}
                  </div>
                  <div className={styles.leadValue}>
                    Est. ₦{lead.estimatedValue.toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* COLD — Went Quiet */}
          <div className={styles.boardColumn}>
            <div className={styles.boardColumnHeader}>
              <Snowflake size={15} style={{ color: "#60a5fa" }} />
              <span className={styles.boardColumnTitle}>Went Quiet</span>
              <span className={styles.boardColumnCount}>{board.summary.coldCount}</span>
            </div>
            {board.coldViewers.length === 0 ? (
              <div className={styles.empty}>No one here right now</div>
            ) : (
              board.coldViewers.map((viewer) => (
                <div key={viewer.customerId} className={styles.leadCard}>
                  <div className={styles.leadName}>{viewer.name}</div>
                  <div className={styles.leadPhone}>{viewer.phone.split("@")[0]}</div>
                  <div className={styles.leadMeta}>
                    Viewed {viewer.viewCount}x · last seen {viewer.daysSinceView}d ago
                  </div>
                </div>
              ))
            )}
          </div>

          {/* LOST — Slipped Away */}
          <div className={styles.boardColumn}>
            <div className={styles.boardColumnHeader}>
              <Clock size={15} style={{ color: "#fbbf24" }} />
              <span className={styles.boardColumnTitle}>Slipped Away</span>
              <span className={styles.boardColumnCount}>{board.summary.lostCount}</span>
            </div>
            {board.lostOpportunities.length === 0 ? (
              <div className={styles.empty}>No one here right now</div>
            ) : (
              board.lostOpportunities.map((lost) => (
                <div key={lost.customerId} className={styles.leadCard}>
                  <div className={styles.leadName}>{lost.name}</div>
                  <div className={styles.leadPhone}>{lost.phone.split("@")[0]}</div>
                  <div className={styles.leadReason}>{lost.reason}</div>
                  <div className={styles.leadMeta}>Silent for {lost.daysSilent} days</div>
                  <div className={styles.leadValue}>
                    Est. ₦{lost.estimatedValue.toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function FunnelStep({
  label,
  value,
  isRevenue,
}: {
  label: string;
  value: number | string;
  isRevenue?: boolean;
}) {
  return (
    <div className={styles.funnelStep}>
      <div className={styles.funnelValue}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className={styles.funnelLabel}>{label}</div>
    </div>
  );
}

function Arrow({ conversion }: { conversion?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem" }}>
      <ChevronRight size={14} className={styles.funnelArrow} />
      {conversion !== undefined && conversion > 0 && (
        <span className={styles.conversionBadge}>{conversion}%</span>
      )}
    </div>
  );
}

function RecoveryCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant?: "green" | "red";
}) {
  const valueClass = variant === "green"
    ? `${styles.recoveryValue} ${styles.recoveryValueGreen}`
    : variant === "red"
      ? `${styles.recoveryValue} ${styles.recoveryValueRed}`
      : styles.recoveryValue;

  return (
    <div className={styles.recoveryCard}>
      <div className={valueClass}>{value}</div>
      <div className={styles.recoveryLabel}>{label}</div>
    </div>
  );
}
