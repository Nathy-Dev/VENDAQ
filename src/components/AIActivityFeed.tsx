"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { formatDistanceToNow } from "date-fns";
import { Brain, Eye, MessageSquareReply, ArrowUpCircle, AlertCircle, Zap, CheckCircle2, XCircle } from "lucide-react";

const TYPE_CONFIG = {
  classification: {
    icon: Brain,
    color: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.1)",
    label: "Intent Classified",
  },
  image_analysis: {
    icon: Eye,
    color: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.1)",
    label: "Image Analyzed",
  },
  smart_reply: {
    icon: MessageSquareReply,
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.1)",
    label: "Smart Reply",
  },
  intent_upgrade: {
    icon: ArrowUpCircle,
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.1)",
    label: "Intent Upgraded",
  },
  error: {
    icon: AlertCircle,
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.1)",
    label: "AI Error",
  },
} as const;

interface AIActivityFeedProps {
  businessId: Id<"businesses">;
}

export default function AIActivityFeed({ businessId }: AIActivityFeedProps) {
  const activities = useQuery(api.ai.getAIActivityFeed, { businessId, limit: 20 });
  const metrics = useQuery(api.ai.getAIMetrics, { businessId });

  if (activities === undefined || metrics === undefined) {
    return (
      <div style={{ padding: "1rem", borderRadius: "0.75rem", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <Brain size={16} style={{ color: "#8b5cf6" }} />
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e2e8f0" }}>AI Activity</span>
        </div>
        <div style={{ color: "#64748b", fontSize: "0.75rem" }}>Loading AI activity...</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* AI Status Bar */}
      <div style={{
        padding: "0.75rem 1rem",
        borderRadius: "0.75rem",
        background: "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.08))",
        border: "1px solid rgba(139,92,246,0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "0.5rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Zap size={14} style={{ color: "#8b5cf6" }} />
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#e2e8f0", letterSpacing: "0.05em" }}>
            AI ENGINE
          </span>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <ModelStatus label="Groq LLM" model={metrics.llmModel} active={metrics.groqConfigured} />
          <ModelStatus label="OpenAI Vision" model={metrics.visionModel} active={metrics.openaiConfigured} />
        </div>
      </div>

      {/* AI Metrics Row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
        gap: "0.5rem",
      }}>
        <MetricBadge label="Classified" value={metrics.totalClassificationsToday} color="#8b5cf6" />
        <MetricBadge label="Images" value={metrics.totalImageAnalysesToday} color="#3b82f6" />
        <MetricBadge label="Smart Replies" value={metrics.totalSmartRepliesToday} color="#10b981" />
        <MetricBadge label="Upgrades" value={metrics.totalIntentUpgradesToday} color="#f59e0b" />
        {metrics.avgConfidenceToday > 0 && (
          <MetricBadge label="Avg Confidence" value={`${metrics.avgConfidenceToday}%`} color="#06b6d4" />
        )}
      </div>

      {/* Activity Feed */}
      <div style={{
        borderRadius: "0.75rem",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Brain size={14} style={{ color: "#8b5cf6" }} />
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#e2e8f0" }}>Live AI Activity</span>
          </div>
          {activities.length > 0 && (
            <span style={{ fontSize: "0.65rem", color: "#64748b" }}>{activities.length} recent</span>
          )}
        </div>

        <div style={{ maxHeight: "320px", overflowY: "auto" }}>
          {activities.length === 0 ? (
            <div style={{
              padding: "2rem 1rem",
              textAlign: "center",
              color: "#64748b",
              fontSize: "0.75rem",
            }}>
              <Brain size={24} style={{ margin: "0 auto 0.5rem", opacity: 0.3 }} />
              <p style={{ margin: 0 }}>No AI activity yet.</p>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.7rem" }}>
                AI will start processing messages as they come in.
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
                    padding: "0.6rem 1rem",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                    display: "flex",
                    gap: "0.6rem",
                    alignItems: "flex-start",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{
                    width: 26,
                    height: 26,
                    borderRadius: "0.375rem",
                    background: config.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 1,
                  }}>
                    <Icon size={13} style={{ color: config.color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: "0.72rem",
                      color: "#cbd5e1",
                      lineHeight: 1.4,
                      wordBreak: "break-word",
                    }}>
                      {activity.summary}
                    </div>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginTop: "0.2rem",
                    }}>
                      <span style={{ fontSize: "0.6rem", color: "#475569" }}>
                        {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                      </span>
                      {activity.confidence !== undefined && activity.confidence !== null && (
                        <span style={{
                          fontSize: "0.6rem",
                          color: activity.confidence >= 0.8 ? "#10b981" : activity.confidence >= 0.6 ? "#f59e0b" : "#ef4444",
                          fontWeight: 600,
                        }}>
                          {Math.round(activity.confidence * 100)}%
                        </span>
                      )}
                      <span style={{ fontSize: "0.55rem", color: "#334155" }}>
                        {activity.model}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function ModelStatus({ label, model, active }: { label: string; model: string; active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
      {active ? (
        <CheckCircle2 size={11} style={{ color: "#10b981" }} />
      ) : (
        <XCircle size={11} style={{ color: "#ef4444" }} />
      )}
      <span style={{ fontSize: "0.65rem", color: active ? "#94a3b8" : "#64748b" }}>
        {label}
      </span>
    </div>
  );
}

function MetricBadge({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{
      padding: "0.5rem 0.6rem",
      borderRadius: "0.5rem",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      textAlign: "center",
    }}>
      <div style={{ fontSize: "1rem", fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: "0.6rem", color: "#64748b", marginTop: "0.1rem" }}>{label}</div>
    </div>
  );
}
