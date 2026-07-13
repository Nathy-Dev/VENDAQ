"use client";

import { useSession } from "next-auth/react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  AlertTriangle,
  Banknote,
  MessageSquare,
  Reply,
  Send,
  Wifi,
  WifiOff,
  Loader2,
  RefreshCcw,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import styles from "./dashboard.module.css";
import Loader from "@/components/Loader";
import LeadPipeline from "@/components/LeadPipeline";
import AIActivityFeed from "@/components/AIActivityFeed";
import { PooledOrders } from "@/types";

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const RECONNECT_POLL_INTERVAL_MS = 8_000;
const RECONNECT_TIMEOUT_MS = 120_000;

export default function DashboardPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  const business = useQuery(
    api.businesses.getBusiness,
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  const orders = useQuery(
    api.orders.getOrdersByBusiness,
    business ? { businessId: business._id } : "skip"
  ) as PooledOrders | undefined;

  const mvpMetrics = useQuery(
    api.whatsapp.getMvpRevenueMetrics,
    business ? { businessId: business._id, period } : "skip"
  );

  const qrData = useQuery(
    api.whatsapp.getBusinessQR,
    business && business.whatsappStatus !== "connected"
      ? { businessId: business._id }
      : "skip"
  );

  const disconnectionAlerts = useQuery(
    api.safeguards.getActiveDisconnectionAlerts,
    business ? { businessId: business._id } : "skip"
  );
  const dismissAlert = useMutation(api.safeguards.dismissDisconnectionAlert);

  const checkHealth = useAction(api.whatsapp.checkConnectionHealth);
  const reconnectInstance = useAction(api.whatsapp.reconnectInstance);
  const pollStatus = useAction(api.whatsapp.pollConnectionStatus);
  const updateStatus = useMutation(api.whatsapp.updateConnectionStatus);

  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectActionDoneRef = useRef(false);

  useEffect(() => {
    if (!business || !business.evolutionInstanceName) {
      if (healthIntervalRef.current) {
        clearInterval(healthIntervalRef.current);
        healthIntervalRef.current = null;
      }
      return;
    }

    if (isReconnecting && business.whatsappStatus === "pending") return;

    const doCheck = async () => {
      try {
        await checkHealth({ businessId: business._id });
      } catch (_e) {}
    };

    doCheck();
    healthIntervalRef.current = setInterval(doCheck, HEALTH_CHECK_INTERVAL_MS);

    return () => {
      if (healthIntervalRef.current) {
        clearInterval(healthIntervalRef.current);
        healthIntervalRef.current = null;
      }
    };
  }, [
    business?._id,
    business?.evolutionInstanceName,
    business?.whatsappStatus,
    isReconnecting,
    checkHealth,
  ]);

  useEffect(() => {
    if (!business || business.whatsappStatus !== "pending" || !isReconnecting) {
      if (reconnectPollRef.current) {
        clearInterval(reconnectPollRef.current);
        reconnectPollRef.current = null;
      }
      return;
    }

    reconnectPollRef.current = setInterval(async () => {
      if (!reconnectActionDoneRef.current) return;
      try {
        const result = await pollStatus({ businessId: business._id });
        if (result.connected) {
          setIsReconnecting(false);
          setReconnectError(null);
        }
      } catch (_e) {}
    }, RECONNECT_POLL_INTERVAL_MS);

    return () => {
      if (reconnectPollRef.current) {
        clearInterval(reconnectPollRef.current);
        reconnectPollRef.current = null;
      }
    };
  }, [business?._id, business?.whatsappStatus, isReconnecting, pollStatus]);

  const reconnectStartedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (isReconnecting) {
      if (!reconnectStartedAtRef.current) {
        reconnectStartedAtRef.current = Date.now();
      }
      const elapsed = Date.now() - reconnectStartedAtRef.current;
      const remaining = Math.max(0, RECONNECT_TIMEOUT_MS - elapsed);

      const timeout = setTimeout(async () => {
        setIsReconnecting(false);
        setReconnectError("Reconnection timed out. Please try again.");
        reconnectStartedAtRef.current = null;
        if (business) {
          try {
            await updateStatus({ businessId: business._id, status: "disconnected" });
          } catch (_e) {}
        }
      }, remaining);

      return () => clearTimeout(timeout);
    } else {
      reconnectStartedAtRef.current = null;
    }
  }, [isReconnecting, business, updateStatus]);

  const prevWhatsappStatus = useRef(business?.whatsappStatus);
  useEffect(() => {
    const currentStatus = business?.whatsappStatus;
    if (prevWhatsappStatus.current !== currentStatus) {
      prevWhatsappStatus.current = currentStatus;
      if (isReconnecting) {
        if (currentStatus === "connected") {
          queueMicrotask(() => {
            setIsReconnecting(false);
            setReconnectError(null);
          });
        } else if (currentStatus === "disconnected") {
          queueMicrotask(() => {
            setIsReconnecting(false);
            setReconnectError("QR code expired. Tap Reconnect to try again.");
          });
        }
      }
    }
  }, [business?.whatsappStatus, isReconnecting]);

  useEffect(() => {
    if (sessionStatus === "unauthenticated") router.push("/login");
  }, [sessionStatus, router]);

  const handleReconnect = useCallback(async () => {
    if (!business || isReconnecting) return;
    reconnectActionDoneRef.current = false;
    setIsReconnecting(true);
    setReconnectError(null);
    try {
      const result = await reconnectInstance({ businessId: business._id });
      reconnectActionDoneRef.current = true;
      if (!result.success) {
        setReconnectError(result.error || "Reconnection failed. Please try again.");
        setIsReconnecting(false);
      } else if (!result.needsQR) {
        setIsReconnecting(false);
      }
    } catch (e) {
      reconnectActionDoneRef.current = true;
      setReconnectError(
        e instanceof Error ? e.message : "Reconnection failed. Please try again."
      );
      setIsReconnecting(false);
    }
  }, [business, isReconnecting, reconnectInstance]);

  const isBusinessLoading =
    sessionStatus === "authenticated" && session?.user?.id && business === undefined;

  if (sessionStatus === "loading" || isBusinessLoading) return <Loader />;
  if (sessionStatus === "unauthenticated") return null;

  const hasExistingInstance = !!business?.evolutionInstanceName;
  const isDisconnected = business && business.whatsappStatus !== "connected";
  const isPending = business?.whatsappStatus === "pending";
  const showReconnectBanner = isDisconnected && hasExistingInstance;
  const showOnboardingBanner = !business || (isDisconnected && !hasExistingInstance);

  const PERIOD_LABELS: Record<typeof period, string> = {
    today: "Today",
    week: "This Week",
    month: "This Month",
  };

  const firstName = session?.user?.name?.split(" ")[0] || "there";

  return (
    <div className={styles.container}>
      <div className={styles.wrapper}>

        {/* ── Header ─────────────────────────────────────────── */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h1 className={styles.welcomeTitle}>
              Welcome back, {firstName}!
            </h1>
            <p className={styles.subTitle}>Here&apos;s what&apos;s happening with your business today.</p>
            {business?.lastHistorySyncAt && (
              <p className={styles.syncStatus}>
                Last sync: {business.lastHistorySyncCount || 0} messages ·{" "}
                {formatDistanceToNow(business.lastHistorySyncAt, { addSuffix: true })}
              </p>
            )}
          </div>

          <div className={styles.periodToggle}>
            {(["today", "week", "month"] as const).map((p) => (
              <button
                key={p}
                className={`${styles.periodBtn} ${period === p ? styles.periodBtnActive : ""}`}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </header>

        {/* ── Connection banners ──────────────────────────────── */}
        {showReconnectBanner && (
          <div
            className={`${styles.alertBanner} ${
              isReconnecting || isPending ? styles.alertBannerWarning : ""
            }`}
          >
            <div className={styles.alertInfo}>
              <div className={styles.alertTitle}>
                <WifiOff
                  size={16}
                  style={{ color: isReconnecting || isPending ? "#f59e0b" : "#ef4444" }}
                />
                {isReconnecting || isPending
                  ? "Connecting…"
                  : business.whatsappStatus === "error"
                  ? "Connection Error"
                  : "WhatsApp Disconnected"}
              </div>
              <p className={styles.alertDesc}>
                {isReconnecting || isPending
                  ? "Open WhatsApp → Linked Devices → Link a Device, then scan the QR code below."
                  : "Your WhatsApp session ended. Tap Reconnect to re-link — your data is safe."}
              </p>
              {reconnectError && <p className={styles.alertError}>{reconnectError}</p>}

              {isReconnecting && (qrData?.qrCode || qrData?.pairingCode) && (
                <div className={styles.qrPanel}>
                  {qrData.pairingCode ? (
                    <>
                      <p className={styles.qrHint}>Enter this pairing code on WhatsApp:</p>
                      <div className={styles.pairingGrid}>
                        {qrData.pairingCode.split("").map((char, i) => (
                          <span key={i} className={styles.pairingChar}>{char}</span>
                        ))}
                      </div>
                    </>
                  ) : qrData.qrCode ? (
                    <>
                      <p className={styles.qrHint}>Scan this QR code with WhatsApp:</p>
                      <div style={{ background: "white", padding: "0.5rem", borderRadius: "0.5rem" }}>
                        {qrData.qrCode.startsWith("data:image") || qrData.qrCode.length > 500 ? (
                          <Image
                            src={
                              qrData.qrCode.startsWith("data:image")
                                ? qrData.qrCode
                                : `data:image/png;base64,${qrData.qrCode}`
                            }
                            alt="WhatsApp QR Code"
                            width={160}
                            height={160}
                            unoptimized
                          />
                        ) : (
                          <div style={{ width: 160, height: 160, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", color: "#64748b" }}>
                            QR Code Ready
                          </div>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {isReconnecting && !qrData?.qrCode && !qrData?.pairingCode && (
                <div className={styles.qrSpinner}>
                  <Loader2 size={14} className="animate-spin" style={{ color: "#f59e0b" }} />
                  <span>Generating QR code…</span>
                </div>
              )}
            </div>

            <div className={styles.alertActions}>
              {!isReconnecting && !isPending && (
                <button
                  onClick={handleReconnect}
                  className={`${styles.alertBtn} ${styles.alertBtnPrimary}`}
                  disabled={isReconnecting}
                >
                  <RefreshCcw size={14} />
                  Reconnect
                </button>
              )}
              {isReconnecting && (
                <button
                  onClick={async () => {
                    setIsReconnecting(false);
                    setReconnectError(null);
                    if (business) {
                      try {
                        await updateStatus({ businessId: business._id, status: "disconnected" });
                      } catch (_e) {}
                    }
                  }}
                  className={`${styles.alertBtn} ${styles.alertBtnSecondary}`}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {showOnboardingBanner && (
          <div className={`${styles.alertBanner} ${styles.alertBannerGreen}`}>
            <div className={styles.alertInfo}>
              <div className={styles.alertTitle}>
                <Wifi size={16} style={{ color: "#10b981" }} />
                {!business ? "Welcome to PIPELIXR!" : "Connect Your WhatsApp"}
              </div>
              <p className={styles.alertDesc}>
                {!business
                  ? "Finalize your setup to start capturing leads and managing your pipeline automatically."
                  : "Complete setup to connect WhatsApp and start syncing messages."}
              </p>
            </div>
            <div className={styles.alertActions}>
              <button
                onClick={() => router.push("/onboarding")}
                className={`${styles.alertBtn} ${styles.alertBtnPrimary}`}
              >
                Get Started
              </button>
            </div>
          </div>
        )}

        {/* ── Stat cards ──────────────────────────────────────── */}
        <div className={styles.statsGrid}>
          <StatCard
            icon={MessageSquare}
            label="Total Signals"
            value={mvpMetrics?.totalSignals?.toString() ?? "0"}
            color="rgba(59, 130, 246, 0.12)"
            iconColor="#3b82f6"
          />
          <StatCard
            icon={Reply}
            label="Replied"
            value={mvpMetrics?.replied?.toString() ?? "0"}
            color="rgba(16, 185, 129, 0.12)"
            iconColor="#10b981"
          />
          <StatCard
            icon={Send}
            label="Followed Up"
            value={mvpMetrics?.followedUp?.toString() ?? "0"}
            color="rgba(139, 92, 246, 0.12)"
            iconColor="#8b5cf6"
          />
          <StatCard
            icon={AlertTriangle}
            label="Missed"
            value={mvpMetrics?.lost?.toString() ?? "0"}
            color="rgba(245, 158, 11, 0.12)"
            iconColor="#f59e0b"
          />
        </div>

        {/* ── Lost revenue hero ────────────────────────────────── */}
        <div className={styles.lostRevenueCard}>
          <div className={styles.lostRevenueLeft}>
            <div className={styles.lostRevenueIconBox}>
              <Banknote size={24} />
            </div>
            <div className={styles.lostRevenueContent}>
              <div className={styles.lostRevenueLabel}>Estimated Lost Revenue</div>
              <div className={styles.lostRevenueAmount}>
                NGN {(mvpMetrics?.estimatedLostRevenue || 0).toLocaleString()}
              </div>
              <div className={styles.lostRevenueSub}>
                {mvpMetrics?.lost || 0} buying signal
                {(mvpMetrics?.lost || 0) !== 1 ? "s" : ""} went unanswered this period
              </div>
            </div>
          </div>
          {(mvpMetrics?.lost || 0) > 0 && (
            <div className={styles.lostRevenueBadge}>
              {mvpMetrics?.lost} missed deal{(mvpMetrics?.lost || 0) !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* ── AI Activity Feed ────────────────────────────────── */}
        {business && <AIActivityFeed businessId={business._id} />}

        {/* ── Lead Pipeline ───────────────────────────────────── */}
        <div>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Lead Pipeline</h3>
            {business?.whatsappStatus === "connected" ? (
              <span className={`${styles.statusPill} ${styles.statusPillGreen}`}>
                <Wifi size={10} /> Live Sync Active
              </span>
            ) : business?.whatsappStatus === "pending" ? (
              <span className={`${styles.statusPill} ${styles.statusPillAmber}`}>
                <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> Connecting
              </span>
            ) : business?.evolutionInstanceName ? (
              <span className={`${styles.statusPill} ${styles.statusPillRed}`}>
                <WifiOff size={10} /> Disconnected
              </span>
            ) : null}
          </div>
          <LeadPipeline orders={orders} isLoading={orders === undefined} />
        </div>

      </div>
    </div>
  );
}

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  color: string;
  iconColor: string;
}

function StatCard({ icon: Icon, label, value, color, iconColor }: StatCardProps) {
  return (
    <div
      className={styles.statCard}
      style={{ "--stat-color": iconColor } as React.CSSProperties}
    >
      <div className={styles.statHeader}>
        <div
          className={styles.statIconBadge}
          style={{ background: color, color: iconColor }}
        >
          <Icon size={16} />
        </div>
        <span className={styles.statLabel}>{label}</span>
      </div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}
