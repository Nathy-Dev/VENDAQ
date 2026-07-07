"use client";

import { useSession } from "next-auth/react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, Banknote, MessageSquare, Reply, Send, Wifi, WifiOff, Loader2, RefreshCcw, X, type LucideIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import styles from "./dashboard.module.css";
import Loader from "@/components/Loader";
import LeadPipeline from "@/components/LeadPipeline";
import { PooledOrders } from "@/types";

/** How often (ms) the dashboard checks connection health against Evolution Go. */
const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds
/** How often (ms) to poll while reconnecting (waiting for QR scan). */
const RECONNECT_POLL_INTERVAL_MS = 8_000;

export default function DashboardPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  const business = useQuery(api.businesses.getBusiness,
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  const orders = useQuery(api.orders.getOrdersByBusiness,
    business ? { businessId: business._id } : "skip"
  ) as PooledOrders | undefined;

  const mvpMetrics = useQuery(api.whatsapp.getMvpRevenueMetrics,
    business ? { businessId: business._id, period } : "skip"
  );

  // Reactive QR data — used during reconnect flow
  const qrData = useQuery(api.whatsapp.getBusinessQR,
    business && business.whatsappStatus !== "connected" ? { businessId: business._id } : "skip"
  );

  // PRD: Disconnection alerts — reactive query for in-app notifications
  const disconnectionAlerts = useQuery(api.safeguards.getActiveDisconnectionAlerts,
    business ? { businessId: business._id } : "skip"
  );
  const dismissAlert = useMutation(api.safeguards.dismissDisconnectionAlert);

  const checkHealth = useAction(api.whatsapp.checkConnectionHealth);
  const reconnectInstance = useAction(api.whatsapp.reconnectInstance);
  const pollStatus = useAction(api.whatsapp.pollConnectionStatus);
  const updateStatus = useMutation(api.whatsapp.updateConnectionStatus);

  // ---- Connection health polling ----
  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Health check: runs every 30s whenever an instance exists.
  // Detects BOTH disconnections (connected → disconnected) AND
  // reconnections (disconnected → connected, e.g. via Evolution Go dashboard).
  useEffect(() => {
    // Only poll if the business has an Evolution Go instance configured
    if (!business || !business.evolutionInstanceName) {
      if (healthIntervalRef.current) {
        clearInterval(healthIntervalRef.current);
        healthIntervalRef.current = null;
      }
      return;
    }

    // Don't run health checks while actively reconnecting via our UI
    // (the reconnect poll effect handles that case at a faster interval)
    if (isReconnecting && business.whatsappStatus === "pending") {
      return;
    }

    const doCheck = async () => {
      try {
        await checkHealth({ businessId: business._id });
      } catch (_e) {
        // Silently ignore — transient errors shouldn't panic the UI
      }
    };

    // Run one check immediately, then set interval
    doCheck();
    healthIntervalRef.current = setInterval(doCheck, HEALTH_CHECK_INTERVAL_MS);

    return () => {
      if (healthIntervalRef.current) {
        clearInterval(healthIntervalRef.current);
        healthIntervalRef.current = null;
      }
    };
  }, [business?._id, business?.evolutionInstanceName, business?.whatsappStatus, isReconnecting, checkHealth]);

  // Reconnect polling: runs every 8s while pending (waiting for QR scan)
  useEffect(() => {
    if (!business || business.whatsappStatus !== "pending" || !isReconnecting) {
      if (reconnectPollRef.current) {
        clearInterval(reconnectPollRef.current);
        reconnectPollRef.current = null;
      }
      return;
    }

    reconnectPollRef.current = setInterval(async () => {
      try {
        const result = await pollStatus({ businessId: business._id });
        if (result.connected) {
          setIsReconnecting(false);
        }
      } catch (_e) {
        // Silently ignore
      }
    }, RECONNECT_POLL_INTERVAL_MS);

    return () => {
      if (reconnectPollRef.current) {
        clearInterval(reconnectPollRef.current);
        reconnectPollRef.current = null;
      }
    };
  }, [business?._id, business?.whatsappStatus, isReconnecting, pollStatus]);

  // Reset reconnecting state when status changes to connected.
  // We check the previous status to avoid calling setState on every render.
  const prevWhatsappStatus = useRef(business?.whatsappStatus);
  useEffect(() => {
    const currentStatus = business?.whatsappStatus;
    if (prevWhatsappStatus.current !== currentStatus) {
      prevWhatsappStatus.current = currentStatus;
      if (currentStatus === "connected" && isReconnecting) {
        // Schedule state update for next tick to avoid cascading render
        queueMicrotask(() => {
          setIsReconnecting(false);
          setReconnectError(null);
        });
      }
    }
  }, [business?.whatsappStatus, isReconnecting]);

  useEffect(() => {
    if (sessionStatus === "unauthenticated") {
      router.push("/login");
    }
  }, [sessionStatus, router]);

  const handleReconnect = useCallback(async () => {
    if (!business || isReconnecting) return;
    setIsReconnecting(true);
    setReconnectError(null);

    try {
      const result = await reconnectInstance({ businessId: business._id });
      if (!result.success) {
        setReconnectError(result.error || "Reconnection failed. Please try again.");
        setIsReconnecting(false);
      } else if (!result.needsQR) {
        // Already connected — the reactive query will update the UI
        setIsReconnecting(false);
      }
      // If needsQR is true, we stay in reconnecting state and show QR
    } catch (e) {
      setReconnectError(e instanceof Error ? e.message : "Reconnection failed. Please try again.");
      setIsReconnecting(false);
    }
  }, [business, isReconnecting, reconnectInstance]);

  const isBusinessLoading = sessionStatus === "authenticated" && session?.user?.id && business === undefined;

  if (sessionStatus === "loading" || isBusinessLoading) {
    return <Loader />;
  }

  if (sessionStatus === "unauthenticated") {
    return null;
  }

  // Determine if this is a reconnect scenario vs first-time setup
  const hasExistingInstance = !!business?.evolutionInstanceName;
  const isDisconnected = business && business.whatsappStatus !== "connected";
  const isPending = business?.whatsappStatus === "pending";
  const showReconnectBanner = isDisconnected && hasExistingInstance;
  const showOnboardingBanner = !business || (isDisconnected && !hasExistingInstance);

  return (
    <div className={styles.container}>
      <div className={styles.wrapper}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.welcomeTitle}>Welcome back, {session?.user?.name || "Partner"}!</h1>
            <p className={styles.subTitle}>Here&apos;s what&apos;s happening with PIPELIXR today.</p>
            {business?.lastHistorySyncAt && (
              <p className={styles.syncStatus}>
                Recent sync: {business.lastHistorySyncCount || 0} messages in last {business.lastHistorySyncWindowHours || 24}h, updated {formatDistanceToNow(business.lastHistorySyncAt, { addSuffix: true })}.
              </p>
            )}
          </div>
          <div className={styles.periodFilter}>
            <select value={period} onChange={(e) => setPeriod(e.target.value as any)} className="bg-slate-800 text-white rounded-lg px-3 py-2 text-sm outline-none border border-slate-700">
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
          </div>
        </header>

        <div className={styles.statsGrid}>
          <StatCard
            icon={MessageSquare}
            label="Total Signals"
            value={mvpMetrics?.totalSignals?.toString() || "0"}
            color="rgba(59, 130, 246, 0.1)"
            iconColor="#3b82f6"
          />
          <StatCard
            icon={Reply}
            label="Replied"
            value={mvpMetrics?.replied?.toString() || "0"}
            color="rgba(16, 185, 129, 0.1)"
            iconColor="#10b981"
          />
          <StatCard
            icon={Send}
            label="Followed Up"
            value={mvpMetrics?.followedUp?.toString() || "0"}
            color="rgba(139, 92, 246, 0.1)"
            iconColor="#8b5cf6"
          />
          <StatCard
            icon={AlertTriangle}
            label="Lost"
            value={mvpMetrics?.lost?.toString() || "0"}
            color="rgba(245, 158, 11, 0.1)"
            iconColor="#f59e0b"
          />
        </div>

        {/* Hero: Estimated Lost Revenue — PRD: this is the emotional anchor */}
        <div className={styles.lostRevenueHero}>
          <div className={styles.lostRevenueIcon}>
            <Banknote size={28} />
          </div>
          <div className={styles.lostRevenueContent}>
            <div className={styles.lostRevenueLabel}>Estimated Lost Revenue</div>
            <div className={styles.lostRevenueValue}>
              NGN {(mvpMetrics?.estimatedLostRevenue || 0).toLocaleString()}
            </div>
            <div className={styles.lostRevenueSub}>
              {(mvpMetrics?.lost || 0)} buying signal{(mvpMetrics?.lost || 0) !== 1 ? 's' : ''} went unanswered · You could have closed {(mvpMetrics?.lost || 0) > 0 ? 'these' : 'more'} deals
            </div>
          </div>
        </div>

        {/* Reconnect Banner — for users who have an instance but are disconnected */}
        {showReconnectBanner && (
          <div className={styles.connectBanner} style={{
            borderColor: (isReconnecting || isPending) ? '#f59e0b' : business.whatsappStatus === "error" ? '#ef4444' : '#ef4444',
            borderWidth: '1px',
            borderStyle: 'solid',
          }}>
            <div className={styles.connectInfo}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <WifiOff size={18} style={{ color: (isReconnecting || isPending) ? '#f59e0b' : '#ef4444' }} />
                <h3 className={styles.connectTitle} style={{ margin: 0 }}>
                  {(isReconnecting || isPending) ? "Reconnecting..." : business.whatsappStatus === "error" ? "Connection Error" : "WhatsApp Disconnected"}
                </h3>
              </div>
              <p className={styles.connectDesc}>
                {(isReconnecting || isPending)
                  ? "Waiting for you to scan the QR code. Open WhatsApp → Linked Devices → Link a Device."
                  : "Your WhatsApp session was disconnected. Tap Reconnect to link again — no need to start over."}
              </p>
              {reconnectError && (
                <p style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '0.25rem' }}>{reconnectError}</p>
              )}

              {/* Inline QR display during reconnect */}
              {isReconnecting && (qrData?.qrCode || qrData?.pairingCode) && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.75rem',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '0.75rem',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  {qrData.pairingCode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>Enter this pairing code on WhatsApp:</p>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                        {qrData.pairingCode.split("").map((char, i) => (
                          <span key={i} style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: '2rem', height: '2.5rem', background: 'rgba(16,185,129,0.1)',
                            border: '1px solid rgba(16,185,129,0.3)', borderRadius: '0.375rem',
                            color: '#10b981', fontWeight: 700, fontSize: '1.1rem', fontFamily: 'monospace',
                          }}>{char}</span>
                        ))}
                      </div>
                    </div>
                  ) : qrData.qrCode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                      <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>Scan this QR with WhatsApp:</p>
                      <div style={{ background: 'white', padding: '0.5rem', borderRadius: '0.5rem', display: 'inline-block' }}>
                        {(qrData.qrCode.startsWith('data:image') || qrData.qrCode.length > 500) ? (
                          <Image
                            src={qrData.qrCode.startsWith('data:image') ? qrData.qrCode : `data:image/png;base64,${qrData.qrCode}`}
                            alt="WhatsApp QR Code"
                            width={160}
                            height={160}
                            unoptimized
                          />
                        ) : (
                          <div style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: '#64748b' }}>QR Code Ready</div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Loading spinner during reconnect before QR arrives */}
              {isReconnecting && !qrData?.qrCode && !qrData?.pairingCode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <Loader2 size={16} className="animate-spin" style={{ color: '#f59e0b' }} />
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Generating QR code...</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flexShrink: 0 }}>
              {!isReconnecting && !isPending && (
                <button
                  onClick={handleReconnect}
                  className={styles.connectButton}
                  disabled={isReconnecting}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <RefreshCcw size={16} />
                  Reconnect
                </button>
              )}
              {isReconnecting && (
                <button
                  onClick={async () => {
                    setIsReconnecting(false);
                    setReconnectError(null);
                    // Also reset DB status so the banner shows "Reconnect" button
                    if (business) {
                      try {
                        await updateStatus({ businessId: business._id, status: "disconnected" });
                      } catch (_e) { /* ignore */ }
                    }
                  }}
                  className={styles.connectButton}
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8', fontSize: '0.8rem' }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {/* First-time onboarding banner — no existing instance */}
        {showOnboardingBanner && (
          <div className={styles.connectBanner}>
            <div className={styles.connectInfo}>
              <h3 className={styles.connectTitle}>
                {!business ? "Welcome to PIPELIXR! Connect your WhatsApp" : "Set Up WhatsApp Connection"}
              </h3>
              <p className={styles.connectDesc}>
                {!business
                  ? "Finalize your setup to start capturing leads and managing your pipeline automatically."
                  : "Complete the setup to connect your WhatsApp and start syncing messages."}
              </p>
            </div>
            <button
              onClick={() => router.push("/onboarding")}
              className={styles.connectButton}
            >
              Get Started
            </button>
          </div>
        )}


        <div className={styles.dashboardGrid}>
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest px-1">Lead Pipeline</h3>
              {business?.whatsappStatus === "connected" ? (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded-full font-bold flex items-center gap-1">
                  <Wifi size={10} /> LIVE SYNC ACTIVE
                </span>
              ) : business?.whatsappStatus === "pending" ? (
                <span className="text-[10px] bg-amber-500/10 text-amber-500 px-2 py-1 rounded-full font-bold flex items-center gap-1">
                  <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> CONNECTING...
                </span>
              ) : business?.evolutionInstanceName ? (
                <span className="text-[10px] bg-red-500/10 text-red-500 px-2 py-1 rounded-full font-bold flex items-center gap-1">
                  <WifiOff size={10} /> DISCONNECTED
                </span>
              ) : null}
            </div>
            <LeadPipeline orders={orders} isLoading={orders === undefined} />
          </div>
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
    <div className={styles.statCard}>
      <div className={styles.statIconWrapper} style={{ backgroundColor: color, color: iconColor }}>
        <Icon size={22} />
      </div>
      <div>
        <div className={styles.statLabel}>{label}</div>
        <div className={styles.statValue}>{value}</div>
      </div>
    </div>
  );
}
