"use client";

import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageSquare, 
  Zap, 
  RefreshCcw, 
  ArrowRight, 
  CheckCircle2, 
  ShieldAlert, 
  Smartphone,
  ChevronLeft,
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff
} from 'lucide-react';
import styles from "./onboarding.module.css";
import { clsx } from "clsx";
import { useRouter } from "next/navigation";
import Link from 'next/link';
import { usePipelixrActions } from "@/hooks/usePipelixr";
import { useSession } from "next-auth/react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import QRCode from "react-qr-code";

const features = [
  {
    title: "Say Goodbye to Chat Chaos",
    description: "PIPELIXR automatically captures leads from your WhatsApp messages. No more lost customers in buried threads.",
    icon: MessageSquare,
    color: "#10b981"
  },
  {
    title: "The Invisible Assistant",
    description: "Our AI extracts orders, addresses, and intent directly from chats. It works while you sleep.",
    icon: Zap,
    color: "#f59e0b"
  },
  {
    title: "Sell While You Sleep",
    description: "Automated follow-ups and Paystack links sent exactly when your customers are ready to buy.",
    icon: RefreshCcw,
    color: "#3b82f6"
  }
];

/** How often (ms) we poll Evolution Go for connection status during the QR screen. */
const STATUS_POLL_INTERVAL_MS = 8000;
/** Delay (ms) after "connected" before we redirect to dashboard. */
const REDIRECT_DELAY_MS = 2500;

interface OnboardingProps {
  initialStep?: number;
}

export default function Onboarding({ initialStep = 0 }: OnboardingProps) {
  const [step, setStep] = useState(initialStep); // 0-2: Features, 3: Mode Selection, 4: Connection
  const [featureIndex, setFeatureIndex] = useState(0);
  const [selectedMode, setSelectedMode] = useState<'official' | 'unofficial' | null>(null);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [assistantPhone, setAssistantPhone] = useState("");

  // Loading / error states
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showConnectedOverlay, setShowConnectedOverlay] = useState(false);

  const router = useRouter();
  const { createOrUpdateBusiness } = usePipelixrActions();
  const provisionInstance = useAction(api.whatsapp.provisionEvolutionGoInstance);
  const refreshQR = useAction(api.whatsapp.refreshQRCode);
  const pollStatus = useAction(api.whatsapp.pollConnectionStatus);
  const setAssistantAdminPhone = useMutation(api.whatsapp.setAssistantAdminPhone);
  const { data: session } = useSession();

  // Query Convex for QR code and status (reactive - updates in real time)
  const businessId = session?.user?.id;
  const existingBusiness = useQuery(api.businesses.getBusiness, { ownerId: businessId || "" });

  const qrData = useQuery(api.whatsapp.getBusinessQR, 
    existingBusiness ? { businessId: existingBusiness._id } : "skip"
  );

  // ---- Connection status polling ----
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return; // already polling
    if (!existingBusiness) return;

    pollIntervalRef.current = setInterval(async () => {
      try {
        await pollStatus({ businessId: existingBusiness._id });
      } catch (e) {
        // Silently ignore poll errors
      }
    }, STATUS_POLL_INTERVAL_MS);
  }, [existingBusiness, pollStatus]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Start polling when we hit the connection step
  React.useEffect(() => {
    if (step === 4 && existingBusiness && qrData?.status !== "connected") {
      startPolling();
    }
    return () => stopPolling();
  }, [step, existingBusiness, qrData?.status, startPolling, stopPolling]);

  // ---- Auto-redirect with success animation ----
  React.useEffect(() => {
    if (qrData?.status === "connected" && step === 4) {
      stopPolling();
      setShowConnectedOverlay(true);
      const timeout = setTimeout(() => {
        router.push("/dashboard");
      }, REDIRECT_DELAY_MS);
      return () => clearTimeout(timeout);
    }
  }, [qrData?.status, step, router, stopPolling]);

  // ---- Resume state from existing business ----
  React.useEffect(() => {
    if (!existingBusiness || step < 3) return;
    if (existingBusiness.whatsappMode === "unofficial") {
      setSelectedMode("unofficial");
      if (initialStep >= 3) {
        setStep(4);
      }
    }
  }, [existingBusiness, step, initialStep]);

  const nextFeature = () => {
    if (featureIndex < features.length - 1) {
      setFeatureIndex(featureIndex + 1);
    } else {
      setStep(3);
    }
  };

  const handleConfirmMode = async () => {
    if (!selectedMode) return;
    
    setIsProvisioning(true);
    setProvisionError(null);

    try {
      const ownerId = session?.user?.id || "anonymous";
      const humanReadableName =
        session?.user?.name?.trim() ||
        session?.user?.email?.split("@")[0]?.trim() ||
        "My Business";
      
      const newBusinessId = await createOrUpdateBusiness({
        name: humanReadableName,
        ownerId,
        onboardingStep: 4,
        whatsappMode: selectedMode,
      });

      if (selectedMode === "unofficial" && assistantPhone.trim()) {
        await setAssistantAdminPhone({
          businessId: newBusinessId,
          phone: assistantPhone.trim(),
        });
      }
      
      setStep(4);

      // Provision an Evolution Go instance for this business
      if (selectedMode === "unofficial" && newBusinessId) {
        const result = await provisionInstance({ businessId: newBusinessId });
        if (result.error) {
          setProvisionError(result.error);
        }
      }
    } catch (e) {
      console.error("[Onboarding] Failed to provision:", e);
      setProvisionError(e instanceof Error ? e.message : "Failed to set up WhatsApp connection. Please try again.");
    } finally {
      setIsProvisioning(false);
    }
  };

  const handleRefreshQR = async () => {
    if (!existingBusiness || isRefreshing) return;
    setIsRefreshing(true);
    setProvisionError(null);
    try {
      const result = await refreshQR({ businessId: existingBusiness._id });
      if (!result.success && result.error) {
        setProvisionError(result.error);
      }
    } catch (e) {
      console.error("[Onboarding] Failed to refresh QR:", e);
      setProvisionError("Failed to refresh QR code. Please try again.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRetryProvision = async () => {
    if (!existingBusiness) return;
    setIsProvisioning(true);
    setProvisionError(null);
    try {
      const result = await provisionInstance({ businessId: existingBusiness._id });
      if (result.error) {
        setProvisionError(result.error);
      }
    } catch (e) {
      console.error("[Onboarding] Retry provision failed:", e);
      setProvisionError(e instanceof Error ? e.message : "Retry failed. Please try again.");
    } finally {
      setIsProvisioning(false);
    }
  };

  // Determine what to show in the QR area
  const hasQrOrPairing = !!(qrData?.qrCode || qrData?.pairingCode);
  const isWaitingForCode = !hasQrOrPairing && (qrData?.status === "pending" || isProvisioning);

  return (
    <div className={styles.onboardingContainer}>
      {/* Connected success overlay */}
      <AnimatePresence>
        {showConnectedOverlay && (
          <motion.div
            className={styles.connectedOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
              className={styles.connectedCard}
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.5, type: "spring" }}
              >
                <CheckCircle2 size={64} style={{ color: '#10b981' }} />
              </motion.div>
              <h2 className={styles.connectedTitle}>WhatsApp Connected!</h2>
              <p className={styles.connectedSubtitle}>Taking you to your dashboard...</p>
              <motion.div
                className={styles.connectedProgressBar}
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: REDIRECT_DELAY_MS / 1000, ease: "linear" }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Breadcrumb / Exit Link */}
      {existingBusiness && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={styles.breadcrumb}
        >
          <Link href="/dashboard" className={styles.breadcrumbLink}>
            <ChevronLeft size={16} />
            Back to Dashboard
          </Link>
        </motion.div>
      )}

      <div className={styles.card}>
        {/* Progress Bar */}
        <div className={styles.progressBarTrack}>
          <motion.div 
            className={styles.progressBarFill}
            initial={{ width: "0%" }}
            animate={{ width: `${((step > 2 ? step : featureIndex + 1) / 5) * 100}%` }}
          />
        </div>

        <div className={styles.content}>
          <AnimatePresence mode="wait">
            {step < 3 ? (
              /* ============== FEATURE SLIDES ============== */
              <motion.div 
                key={`feature-${featureIndex}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col items-center text-center"
              >
                <div 
                  className={styles.iconWrapper}
                  style={{ backgroundColor: `${features[featureIndex].color}20` }}
                >
                  {React.createElement(features[featureIndex].icon, { 
                    size: 40, 
                    style: { color: features[featureIndex].color } 
                  })}
                </div>
                <h1 className={styles.title}>{features[featureIndex].title}</h1>
                <p className={styles.description}>
                  {features[featureIndex].description}
                </p>
                <button 
                  onClick={nextFeature}
                  className={styles.primaryButton}
                >
                  {featureIndex === features.length - 1 ? "Get Started" : "Next"}
                  <ArrowRight size={20} />
                </button>
              </motion.div>
            ) : step === 3 ? (
              /* ============== MODE SELECTION ============== */
              <motion.div 
                key="mode-selection"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
              >
                <div className="text-center" style={{ marginBottom: '0.5rem' }}>
                  <h1 className={styles.title} style={{ fontSize: '1.5rem' }}>Choose Your Gateway</h1>
                  <p className={styles.description} style={{ fontSize: '0.875rem', marginBottom: '0' }}>Select how PIPELIXR connects to your WhatsApp</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <button 
                    onClick={() => setSelectedMode('unofficial')}
                    className={clsx(
                      styles.modeButton,
                      selectedMode === 'unofficial' && styles.modeButtonActive
                    )}
                  >
                    <div className={styles.modeHeader}>
                      <div className={styles.modeTitle}>
                        <Smartphone size={20} style={{ color: '#10b981' }} />
                        PIPELIXR Standard
                      </div>
                      {selectedMode === 'unofficial' && <CheckCircle2 size={20} style={{ color: '#10b981' }} />}
                    </div>
                    <p className={styles.modeDesc}>
                      Quick QR-based connection. Perfect for individual sellers and small teams using their existing WhatsApp.
                    </p>
                    <div className={styles.badgeGroup}>
                      <span className={clsx(styles.badge, styles.badgeDefault)}>Unofficial</span>
                      <span className={clsx(styles.badge, styles.badgePrimary)} style={{ color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)' }}>Risk Safeguarded</span>
                    </div>
                  </button>

                  <button 
                    disabled
                    className={clsx(
                      styles.modeButton,
                      styles.modeButtonDisabled
                    )}
                  >
                    <div className={styles.modeHeader}>
                      <div className={styles.modeTitle}>
                        <Zap size={20} style={{ color: '#64748b' }} />
                        Meta Cloud API
                      </div>
                      <span className={clsx(styles.badge, styles.badgeDefault)} style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.05)' }}>Coming Soon</span>
                    </div>
                    <p className={styles.modeDesc} style={{ color: '#475569' }}>
                      Official enterprise scaling via Meta. Optimized for high-volume automated notifications.
                    </p>
                    <div className={styles.badgeGroup}>
                      <span className={clsx(styles.badge, styles.badgePrimary)}>Official</span>
                      <span className={clsx(styles.badge, styles.badgePrimary)} style={{ color: '#3b82f6', background: 'rgba(59, 130, 246, 0.1)' }}>High Scalability</span>
                    </div>
                  </button>
                </div>

                {selectedMode === 'unofficial' && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className={styles.warningBox}
                  >
                    <ShieldAlert size={18} className={styles.warningIcon} />
                    <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left'}}>
                      <p className={styles.warningText}>
                        <strong>Terms of Service & Risk:</strong> PIPELIXR Standard operates by reverse-engineering WhatsApp&apos;s Web protocol. This violates WhatsApp&apos;s Terms of Service. While our core reactive behavior minimizes risk, your number could still be banned. 
                      </p>
                      <label style={{display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: '#cbd5e1', marginTop: '0.5rem'}}>
                        <input 
                          type="checkbox" 
                          checked={tosAccepted}
                          onChange={(e) => setTosAccepted(e.target.checked)}
                          style={{marginTop: '0.2rem'}}
                        />
                        I understand the risks and acknowledge that PIPELIXR enforces behavioral guards (rate limits, delays, no bulk cold messaging) which I cannot disable.
                      </label>
                      <div className={styles.phoneInputContainer}>
                        <label style={{ fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600 }}>
                          WhatsApp number for pairing code
                        </label>
                        <input
                          className={styles.phoneInput}
                          type="tel"
                          inputMode="tel"
                          placeholder="e.g. 2348012345678"
                          value={assistantPhone}
                          onChange={(e) => setAssistantPhone(e.target.value)}
                        />
                        <p className={styles.helpText}>
                          Optional. If you provide a number here, PIPELIXR will request a phone-based pairing code instead of only the QR flow.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}

                <button 
                  disabled={!selectedMode || (selectedMode === 'unofficial' && !tosAccepted) || isProvisioning}
                  onClick={handleConfirmMode}
                  className={styles.primaryButton}
                  style={{ 
                    background: selectedMode && (selectedMode !== 'unofficial' || tosAccepted) && !isProvisioning
                      ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
                      : '#1e293b',
                    opacity: (!selectedMode || (selectedMode === 'unofficial' && !tosAccepted) || isProvisioning) ? 0.5 : 1
                  }}
                >
                  {isProvisioning ? (
                    <>
                      <Loader2 size={20} className={styles.spinner} />
                      Setting up...
                    </>
                  ) : (
                    <>
                      Confirm & Connect
                    </>
                  )}
                </button>
              </motion.div>
            ) : (
              /* ============== CONNECTION STEP ============== */
              <motion.div 
                key="connection"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center"
                style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
              >
                <div className={styles.connectionHeader}>
                  <div className={styles.iconWrapper} style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', margin: '0 auto' }}>
                    <Smartphone size={32} />
                  </div>
                  <h1 className={styles.title} style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Connect WhatsApp</h1>
                  <p className={styles.description} style={{ fontSize: '0.85rem', marginBottom: 0 }}>
                    {(selectedMode === 'unofficial' || existingBusiness?.whatsappMode === "unofficial")
                      ? "Scan the QR code below with WhatsApp → Linked Devices → Link a Device"
                      : "Enter your Meta Developer tokens to establish connection."}
                  </p>
                </div>

                {/* Error banner */}
                {provisionError && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={styles.errorBanner}
                  >
                    <AlertCircle size={16} />
                    <span>{provisionError}</span>
                    <button onClick={handleRetryProvision} className={styles.retryLink} disabled={isProvisioning}>
                      {isProvisioning ? "Retrying..." : "Retry"}
                    </button>
                  </motion.div>
                )}

                {/* QR / Pairing Code display */}
                <div className={styles.qrContainer} style={{ 
                  background: qrData?.qrCode ? 'white' : undefined, 
                  padding: qrData?.qrCode ? '1rem' : undefined,
                  borderColor: qrData?.pairingCode ? '#10b981' : undefined,
                }}>
                  {qrData?.pairingCode ? (
                    <div className={styles.pairingCodeBox}>
                      {qrData.pairingCode.split("").map((char, index) => (
                        <span key={`${char}-${index}`} className={styles.codeChar}>
                          {char}
                        </span>
                      ))}
                    </div>
                  ) : qrData?.qrCode ? (
                    (qrData.qrCode.startsWith('data:image') || qrData.qrCode.length > 500) ? (
                      <img 
                        src={qrData.qrCode.startsWith('data:image') ? qrData.qrCode : `data:image/png;base64,${qrData.qrCode}`} 
                        alt="WhatsApp QR Code" 
                        style={{ width: 200, height: 200 }} 
                      />
                    ) : (
                      <QRCode value={qrData.qrCode} size={200} />
                    )
                  ) : isWaitingForCode ? (
                    <div className={styles.loadingState}>
                      <Loader2 size={32} className={styles.spinner} style={{ color: '#10b981' }} />
                      <span style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.75rem' }}>
                        {isProvisioning ? "Creating your WhatsApp instance..." : "Generating QR code..."}
                      </span>
                    </div>
                  ) : (
                    <div className={styles.loadingState}>
                      <WifiOff size={32} style={{ color: '#64748b' }} />
                      <span style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.75rem' }}>
                        No QR code available
                      </span>
                    </div>
                  )}
                </div>

                {/* Pairing code label */}
                {qrData?.pairingCode && (
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>
                    Enter this code on your WhatsApp → Linked Devices → Link with Phone Number
                  </p>
                )}

                {/* Status + Refresh row */}
                <div className={styles.statusRow}>
                  <div className={styles.statusIndicator}>
                    {qrData?.status === 'connected' ? (
                      <Wifi size={14} style={{ color: '#10b981' }} />
                    ) : qrData?.status === 'pending' ? (
                      <Loader2 size={14} className={styles.spinner} style={{ color: '#f59e0b' }} />
                    ) : (
                      <WifiOff size={14} style={{ color: '#64748b' }} />
                    )}
                    <span style={{ 
                      color: qrData?.status === 'connected' ? '#10b981' 
                        : qrData?.status === 'pending' ? '#f59e0b' 
                        : '#64748b',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                    }}>
                      {qrData?.status === 'connected' ? 'Connected' 
                        : qrData?.status === 'pending' ? 'Waiting for scan...' 
                        : qrData?.status === 'error' ? 'Connection error'
                        : 'Disconnected'}
                    </span>
                  </div>

                  {/* Refresh QR button */}
                  {hasQrOrPairing && qrData?.status !== 'connected' && (
                    <button 
                      onClick={handleRefreshQR}
                      disabled={isRefreshing}
                      className={styles.refreshButton}
                    >
                      <RefreshCcw size={14} className={isRefreshing ? styles.spinner : ''} />
                      {isRefreshing ? 'Refreshing...' : 'Refresh QR'}
                    </button>
                  )}

                  {/* Retry button when no code is available */}
                  {!hasQrOrPairing && !isWaitingForCode && qrData?.status !== 'connected' && (
                    <button 
                      onClick={handleRetryProvision}
                      disabled={isProvisioning}
                      className={styles.refreshButton}
                    >
                      <RefreshCcw size={14} className={isProvisioning ? styles.spinner : ''} />
                      {isProvisioning ? 'Connecting...' : 'Reconnect'}
                    </button>
                  )}
                </div>

                {/* Instructions */}
                {qrData?.status !== 'connected' && (
                  <div className={styles.instructionsList}>
                    <p className={styles.instructionStep}>
                      <span className={styles.stepNumber}>1</span>
                      Open WhatsApp on your phone
                    </p>
                    <p className={styles.instructionStep}>
                      <span className={styles.stepNumber}>2</span>
                      Tap <strong>Settings → Linked Devices → Link a Device</strong>
                    </p>
                    <p className={styles.instructionStep}>
                      <span className={styles.stepNumber}>3</span>
                      {qrData?.pairingCode 
                        ? "Enter the pairing code shown above"
                        : "Point your phone camera at the QR code above"}
                    </p>
                  </div>
                )}
                
                <button 
                  onClick={() => setStep(3)}
                  className={styles.backButton}
                >
                  Go Back
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      
      {/* Background decoration */}
      <div className={styles.bgGlow1} />
      <div className={styles.bgGlow2} />
    </div>
  );
}
