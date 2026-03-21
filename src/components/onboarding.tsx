"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageSquare, 
  Zap, 
  RefreshCcw, 
  ArrowRight, 
  CheckCircle2, 
  ShieldAlert, 
  Smartphone,
  ChevronLeft
} from 'lucide-react';
import styles from "./onboarding.module.css";
import { clsx } from "clsx";
import { useRouter } from "next/navigation";
import Link from 'next/link';
import { usePipelixrActions } from "@/hooks/usePipelixr";
import { useSession } from "next-auth/react";
import { useQuery, useAction } from "convex/react";
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

interface OnboardingProps {
  initialStep?: number;
}

export default function Onboarding({ initialStep = 0 }: OnboardingProps) {
  const [step, setStep] = useState(initialStep); // 0-2: Features, 3: Mode Selection, 4: Connection
  const [featureIndex, setFeatureIndex] = useState(0);
  const [selectedMode, setSelectedMode] = useState<'official' | 'unofficial' | null>(null);
  const [usePairingCode, setUsePairingCode] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  
  const router = useRouter();
  const { createOrUpdateBusiness } = usePipelixrActions();
  const requestPairingCode = useAction(api.whatsapp.requestPairingCodeAction);
  const { data: session } = useSession();

  // Query Convex for QR code and status
  const businessId = session?.user?.id; // Assuming user ID is 1:1 with business owner ID for MVP
  // Get business details to get the actual business ID for the Convex query
  const existingBusiness = useQuery(api.businesses.getBusiness, { ownerId: businessId || "" });
  
  const qrData = useQuery(api.whatsapp.getBusinessQR, 
    existingBusiness ? { businessId: existingBusiness._id } : "skip"
  );

  // Auto-redirect when connected
  React.useEffect(() => {
    if (qrData?.status === "connected") {
        router.push("/dashboard");
    }
  }, [qrData?.status, router]);

  const nextFeature = () => {
    if (featureIndex < features.length - 1) {
      setFeatureIndex(featureIndex + 1);
    } else {
      setStep(3);
    }
  };

  const handleConfirmMode = async () => {
    if (!selectedMode) return;
    
    const ownerId = session?.user?.id || "anonymous";
    
    const newBusinessId = await createOrUpdateBusiness({
      name: "My Business",
      ownerId,
      onboardingStep: 4,
      whatsappMode: selectedMode,
    });
    
    setStep(4);

    // If unofficial, ping the local worker to start generating a QR code
    if (selectedMode === "unofficial" && newBusinessId) {
        try {
            const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:3005";
            await fetch(`${workerUrl}/session/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ businessId: newBusinessId })
            });
        } catch (e) {
            console.error("Failed to start worker session", e);
        }
    }
  };

  const handleRequestPairingCode = async () => {
    if (!phoneNumber || !existingBusiness) return;
    setIsGeneratingCode(true);
    try {
        await requestPairingCode({
            businessId: existingBusiness._id,
            phone: phoneNumber
        });
        // The worker will push the code to Convex, and qrData will update
    } catch (e) {
        console.error("Failed to request pairing code", e);
    } finally {
        setIsGeneratingCode(false);
    }
  };

  return (
    <div className={styles.onboardingContainer}>
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
                  <div className={styles.warningBox}>
                    <ShieldAlert size={18} className={styles.warningIcon} />
                    <p className={styles.warningText}>
                      <strong>Guardians enabled:</strong> We implement human-like typing delays and rate limits to keep your account safe in unofficial mode.
                    </p>
                  </div>
                )}

                <button 
                  disabled={!selectedMode}
                  onClick={handleConfirmMode}
                  className={styles.primaryButton}
                  style={{ background: selectedMode ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '#1e293b' }}
                >
                  Confirm & Connect
                </button>
              </motion.div>
            ) : (
              <motion.div 
                key="connection"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center"
                style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
              >
                <div className={styles.iconWrapper} style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', margin: '0 auto' }}>
                    <Smartphone size={32} />
                </div>
                <div>
                  <h1 className={styles.title} style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Connect WhatsApp</h1>
                  <p className={styles.description} style={{ fontSize: '0.875rem' }}>
                    {selectedMode === 'unofficial' 
                      ? "Scan the QR code with your WhatsApp Link Device feature." 
                      : "Enter your Meta Developer tokens to establish connection."}
                  </p>
                </div>

                <div className={styles.linkToggle}>
                    <button 
                        className={clsx(styles.toggleBtn, !usePairingCode && styles.toggleBtnActive)}
                        onClick={() => setUsePairingCode(false)}
                    >
                        QR Code
                    </button>
                    <button 
                        className={clsx(styles.toggleBtn, usePairingCode && styles.toggleBtnActive)}
                        onClick={() => setUsePairingCode(true)}
                    >
                        Phone Number
                    </button>
                </div>

                {!usePairingCode ? (
                    <div className={styles.qrContainer} style={{ background: qrData?.qrCode ? 'white' : undefined, padding: qrData?.qrCode ? '1rem' : undefined }}>
                        {qrData?.qrCode ? (
                            <QRCode value={qrData.qrCode} size={200} />
                        ) : (
                            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                                {qrData?.status === 'pending' ? 'Generating fresh QR...' : 'Waiting for worker...'}
                            </span>
                        )}
                    </div>
                ) : (
                    <div className={styles.phoneInputContainer}>
                        {!qrData?.pairingCode ? (
                            <>
                                <input 
                                    className={styles.phoneInput}
                                    placeholder="Phone: +234..."
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value)}
                                />
                                <button 
                                    className={styles.primaryButton}
                                    disabled={!phoneNumber || isGeneratingCode}
                                    onClick={handleRequestPairingCode}
                                >
                                    {isGeneratingCode ? "Initiating Pairing..." : "Generate Pairing Code"}
                                </button>
                                <p className={styles.helpText}> Enter your phone number (e.g., +234...) and we will generate a secure link code.</p>
                            </>
                        ) : (
                            <>
                                <div className={styles.pairingCodeBox}>
                                    <span className={styles.codeChar}>{qrData.pairingCode}</span>
                                </div>
                                <p className={styles.helpText} style={{ textAlign: 'center', marginTop: '1rem' }}>
                                    Open WhatsApp on your phone → Settings → Linked Devices → Link with phone number instead → Enter this code.
                                </p>
                                <button 
                                    className={styles.backButton}
                                    style={{ marginTop: '0.5rem' }}
                                    onClick={() => {
                                        setPhoneNumber("");
                                        // We don't have localPairingCode anymore, just reset phone
                                    }} 
                                >
                                    Use a different number
                                </button>
                            </>
                        )}
                    </div>
                )}

                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                         Status: <strong style={{ color: qrData?.status === 'connected' ? '#10b981' : '#f59e0b'}}>{qrData?.status || "disconnected"}</strong>
                    </div>
                </div>
                
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
