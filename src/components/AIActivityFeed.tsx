"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { formatDistanceToNow } from "date-fns";
import {
  Brain,
  Eye,
  MessageSquareReply,
  ArrowUpCircle,
  AlertCircle,
  Zap,
  CheckCircle2,
  XCircle,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";

const TYPE_CONFIG = {
  classification: {
    icon: Brain,
    color: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.1)",
    label: "Classified",
  },
  image_analysis: {
    icon: Eye,
    color: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.1)",
    label: "Image Read",
  },
  smart_reply: {
    icon: MessageSquareReply,
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.1)",
    label: "Auto-Reply",
  },
  intent_upgrade: {
    icon: ArrowUpCircle,
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.1)",
    label: "Intent Upgrade",
  },
  error: {
    icon: AlertCircle,
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.1)",
    label: "Error",
  },
} as const;

interface AIActivityFeedProps {
  businessId: Id<"businesses">;
}

export default function AIActivityFeed({ businessId }: AIActivityFeedProps) {
  const activities = useQuery(api.ai.getAIActivityFeed, { businessId, limit: 20 });
  const metrics = useQuery(api.ai.getAIMetrics, { businessId });
  const [expanded, setExpanded] = useState(false);

  if (activities === undefined || metrics === undefined) {
    return (
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={iconDotStyle("#8b5cf6")}>
              <Brain size={13} />
            </div>
            <span style={sectionTitleStyle}>AI Engine</span>
          </div>
        </div>
        <div style={{ padding: "1.25rem", color: "#374151", fontSize: "0.8rem" }}>
          Loading AI activity…
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      {/* Header row */}
      <div style={cardHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <div style={iconDotStyle("#8b5cf6")}>
            <Brain size={13} />
          </div>
          <span style={sectionTitleStyle}>AI Engine</span>

          {/* Model status pills */}
          <div style={{ display: "flex", gap: "0.5rem", marginLeft: "0.25rem" }}>
            <ModelPill label="Groq" active={metrics.groqConfigured} />
            <ModelPill label="Vision" active={metrics.openaiConfigured} />
          </div>
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.3rem",
            background: "none",
            border: "none",
            color: "#4A5568",
            fontSize: "0.75rem",
            cursor: "pointer",
            fontFamily: "inherit",
            padding: "0.25rem 0.5rem",
            borderRadius: "0.375rem",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#8892A4")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#4A5568")}
        >
          {expanded ? "Hide" : "Show activity"}
          <ChevronDown
            size={13}
            style={{
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
            }}
          />
        </button>
      </div>

      {/* Metrics row — always visible */}
      <div style={metricsRowStyle}>
        <MetricTile label="Classified" value={metrics.totalClassificationsToday} color="#8b5cf6" />
        <MetricTile label="Images Read" value={metrics.totalImageAnalysesToday} color="#3b82f6" />
        <MetricTile label="Auto-Replies" value={metrics.totalSmartRepliesToday} color="#10b981" />
        <MetricTile label="Upgrades" value={metrics.totalIntentUpgradesToday} color="#f59e0b" />
        {metrics.avgConfidenceToday > 0 && (
          <MetricTile
            label="Avg Confidence"
            value={`${metrics.avgConfidenceToday}%`}
            color="#06b6d4"
          />
        )}
      </div>

      {/* Activity feed — toggleable */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.05)",
            maxHeight: 300,
            overflowY: "auto",
          }}
        >
          {activities.length === 0 ? (
            <div
              style={{
                padding: "2rem 1.25rem",
                textAlign: "center",
                color: "#374151",
                fontSize: "0.8rem",
              }}
            >
              <Brain size={22} style={{ margin: "0 auto 0.5rem", opacity: 0.2 }} />
              <p style={{ margin: 0 }}>No activity yet.</p>
              <p style={{ margin: "0.2rem 0 0", fontSize: "0.72rem", color: "#2D3A4A" }}>
                Activity will appear as messages come in.
              </p>
            </div>
          ) : (
            activities.map((activity) => {
              const config = TYPE_CONFIG[activity.type];
              const Icon = config.icon;

              return (
                <div
                  key={activity._id}
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    padding: "0.7rem 1.25rem",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                    alignItems: "flex-start",
                    transition: "background 0.12s",
                    cursor: "default",
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLDivElement).style.background = "transparent")
                  }
                >
                  {/* Icon */}
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "0.4rem",
                      background: config.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    <Icon size={13} style={{ color: config.color }} />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#94A3B8",
                        lineHeight: 1.45,
                        wordBreak: "break-word",
                      }}
                    >
                      {activity.summary}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginTop: "0.25rem",
                      }}
                    >
                      <span style={{ fontSize: "0.67rem", color: "#2D3A4A" }}>
                        {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                      </span>
                      {activity.confidence !== undefined && activity.confidence !== null && (
                        <span
                          style={{
                            fontSize: "0.67rem",
                            fontWeight: 600,
                            color:
                              activity.confidence >= 0.8
                                ? "#10b981"
                                : activity.confidence >= 0.6
                                ? "#f59e0b"
                                : "#ef4444",
                          }}
                        >
                          {Math.round(activity.confidence * 100)}%
                        </span>
                      )}
                      <span style={{ fontSize: "0.62rem", color: "#1E293B" }}>
                        {activity.model}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────── */

function ModelPill({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.2rem 0.5rem",
        borderRadius: 9999,
        background: active ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.06)",
        border: `1px solid ${active ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.15)"}`,
        fontSize: "0.65rem",
        color: active ? "#10b981" : "#ef4444",
        fontWeight: 600,
      }}
    >
      {active ? (
        <CheckCircle2 size={10} />
      ) : (
        <XCircle size={10} />
      )}
      {label}
    </div>
  );
}

function MetricTile({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        borderRadius: "0.625rem",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        textAlign: "center",
        flex: 1,
        minWidth: 72,
      }}
    >
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "0.65rem", color: "#374151", marginTop: "0.25rem", fontWeight: 500 }}>
        {label}
      </div>
    </div>
  );
}

/* ── Style helpers ───────────────────────────────────────── */

const cardStyle: React.CSSProperties = {
  background: "#0D1117",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "1rem",
  overflow: "hidden",
};

const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.875rem 1.25rem",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "#4A5568",
};

const metricsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.625rem",
  padding: "0.875rem 1.25rem",
  flexWrap: "wrap",
};

function iconDotStyle(color: string): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    borderRadius: "0.375rem",
    background: `${color}18`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color,
    flexShrink: 0,
  };
}
