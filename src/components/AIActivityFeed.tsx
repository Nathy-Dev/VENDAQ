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
  CheckCircle2,
  XCircle,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";

const TYPE_CONFIG = {
  classification: {
    icon: Brain,
    color: "#a78bfa",
    bg: "rgba(167, 139, 250, 0.1)",
    label: "Message Read",
    plain: "AI read and understood the message",
  },
  image_analysis: {
    icon: Eye,
    color: "#60a5fa",
    bg: "rgba(96, 165, 250, 0.1)",
    label: "Image Seen",
    plain: "AI looked at the image in the message",
  },
  smart_reply: {
    icon: MessageSquareReply,
    color: "#34d399",
    bg: "rgba(52, 211, 153, 0.1)",
    label: "Reply Sent",
    plain: "AI replied on your behalf",
  },
  intent_upgrade: {
    icon: ArrowUpCircle,
    color: "#fbbf24",
    bg: "rgba(251, 191, 36, 0.1)",
    label: "Interest Detected",
    plain: "AI noticed the customer is more interested",
  },
  error: {
    icon: AlertCircle,
    color: "#f87171",
    bg: "rgba(248, 113, 113, 0.1)",
    label: "Issue",
    plain: "Something went wrong",
  },
} as const;

interface AIActivityFeedProps {
  businessId: Id<"businesses">;
}

export default function AIActivityFeed({ businessId }: AIActivityFeedProps) {
  const activities = useQuery(api.ai.getAIActivityFeed, { businessId, limit: 20 });
  const metrics = useQuery(api.ai.getAIMetrics, { businessId });
  const [expanded, setExpanded] = useState(false);

  const cardStyle: React.CSSProperties = {
    background: "#0d1420",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "1rem",
    overflow: "hidden",
  };

  if (activities === undefined || metrics === undefined) {
    return (
      <div style={cardStyle}>
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={iconBadge("#a78bfa")}>
              <Brain size={13} />
            </div>
            <span style={titleStyle}>AI Assistant</span>
          </div>
        </div>
        <div style={{ padding: "1.5rem", color: "rgba(255,255,255,0.2)", fontSize: "0.82rem", textAlign: "center" }}>
          Loading AI activity…
        </div>
      </div>
    );
  }

  const totalActions =
    metrics.totalSmartRepliesToday +
    metrics.totalClassificationsToday +
    metrics.totalImageAnalysesToday +
    metrics.totalIntentUpgradesToday;

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <div style={iconBadge("#a78bfa")}>
            <Brain size={13} />
          </div>
          <span style={titleStyle}>AI Assistant</span>

          {/* Status pills */}
          <div style={{ display: "flex", gap: "0.4rem", marginLeft: "0.15rem" }}>
            <StatusPill label="Active" active={metrics.groqConfigured} />
            <StatusPill label="Vision" active={metrics.openaiConfigured} />
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
            color: "rgba(255,255,255,0.28)",
            fontSize: "0.75rem",
            cursor: "pointer",
            fontFamily: "inherit",
            padding: "0.25rem 0.5rem",
            borderRadius: "0.375rem",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.55)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.28)")}
        >
          {expanded ? "Hide" : "See activity"}
          <ChevronDown
            size={13}
            style={{
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
            }}
          />
        </button>
      </div>

      {/* Summary metrics — always visible */}
      <div style={{ display: "flex", gap: "0.5rem", padding: "0.875rem 1.25rem", flexWrap: "wrap" }}>
        <MetricTile label="Replied" value={metrics.totalSmartRepliesToday} color="#34d399" />
        <MetricTile label="Messages Read" value={metrics.totalClassificationsToday} color="#a78bfa" />
        <MetricTile label="Images Seen" value={metrics.totalImageAnalysesToday} color="#60a5fa" />
        <MetricTile label="Interest Bumps" value={metrics.totalIntentUpgradesToday} color="#fbbf24" />
        {metrics.avgConfidenceToday > 0 && (
          <MetricTile
            label="Confidence"
            value={`${metrics.avgConfidenceToday}%`}
            color="#06b6d4"
          />
        )}
      </div>

      {/* Activity log — expandable */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.05)",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {activities.length === 0 ? (
            <div
              style={{
                padding: "2.5rem 1.5rem",
                textAlign: "center",
                color: "rgba(255,255,255,0.2)",
                fontSize: "0.82rem",
              }}
            >
              <Brain size={24} style={{ margin: "0 auto 0.6rem", opacity: 0.15, display: "block" }} />
              <p style={{ margin: 0 }}>No activity yet</p>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.72rem", color: "rgba(255,255,255,0.14)" }}>
                The AI will show its work here as messages come in.
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
                    padding: "0.75rem 1.25rem",
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

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.79rem",
                        color: "rgba(255,255,255,0.55)",
                        lineHeight: 1.5,
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
                        marginTop: "0.2rem",
                      }}
                    >
                      <span style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.2)" }}>
                        {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                      </span>
                      {activity.confidence !== undefined && activity.confidence !== null && (
                        <span
                          style={{
                            fontSize: "0.65rem",
                            fontWeight: 600,
                            color:
                              activity.confidence >= 0.8
                                ? "#34d399"
                                : activity.confidence >= 0.6
                                ? "#fbbf24"
                                : "#f87171",
                          }}
                        >
                          {Math.round(activity.confidence * 100)}% confident
                        </span>
                      )}
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

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.18rem 0.5rem",
        borderRadius: 9999,
        background: active ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.06)",
        border: `1px solid ${active ? "rgba(52,211,153,0.18)" : "rgba(248,113,113,0.15)"}`,
        fontSize: "0.62rem",
        color: active ? "#34d399" : "#f87171",
        fontWeight: 600,
      }}
    >
      {active ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
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
        minWidth: 70,
      }}
    >
      <div style={{ fontSize: "1.2rem", fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,0.25)", marginTop: "0.25rem", fontWeight: 500 }}>
        {label}
      </div>
    </div>
  );
}

/* ── Style helpers ───────────────────────────────────────── */

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.875rem 1.25rem",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
};

const titleStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "rgba(255,255,255,0.22)",
};

function iconBadge(color: string): React.CSSProperties {
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
