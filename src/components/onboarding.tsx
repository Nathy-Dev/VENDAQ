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
  const [tosAccepted, setTosAccepted] = useState(false);
  
  const router = useRouter();
  const { createOrUpdateBusiness } = usePipelixrActions();
  const provisionInstance = useAction(api.whatsapp.provisionEvolutionGoInstance);
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
    
    const ownerId = session?.user?.id || "anonymous";
    
    const newBusinessId = await createOrUpdateBusiness({
      name: "My Business",
      ownerId,
      onboardingStep: 4,
      whatsappMode: selectedMode,
    });
    
    setStep(4);

    // Provision an Evolution Go instance for this business
    if (selectedMode === "unofficial" && newBusinessId) {
      try {
        await provisionInstance({ businessId: newBusinessId });
      } catch (e) {
        console.error("[Onboarding] Failed to provision Evolution Go instance:", e);
      }
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
                    </div>
                  </div>
                )}

                <button 
                  disabled={!selectedMode || (selectedMode === 'unofficial' && !tosAccepted)}
                  onClick={handleConfirmMode}
                  className={styles.primaryButton}
                  style={{ 
                    background: selectedMode && (selectedMode !== 'unofficial' || tosAccepted) ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '#1e293b',
                    opacity: (!selectedMode || (selectedMode === 'unofficial' && !tosAccepted)) ? 0.5 : 1
                  }}
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
                    {(selectedMode === 'unofficial' || existingBusiness?.whatsappMode === "unofficial")
                      ? "Scan the QR code with your WhatsApp Link Device feature." 
                      : "Enter your Meta Developer tokens to establish connection."}
                  </p>
                </div>

                <div className={styles.qrContainer} style={{ background: qrData?.qrCode ? 'white' : undefined, padding: qrData?.qrCode ? '1rem' : undefined }}>
                    {qrData?.qrCode ? (
                        (qrData.qrCode.startsWith('data:image') || qrData.qrCode.length > 500) ? (
                            <img 
                                src={qrData.qrCode.startsWith('data:image') ? qrData.qrCode : `data:image/png;base64,${qrData.qrCode}`} 
                                alt="WhatsApp QR Code" 
                                style={{ width: 200, height: 200 }} 
                            />
                        ) : (
                            <QRCode value={qrData.qrCode} size={200} />
                        )
                    ) : (
                        <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                            {qrData?.status === 'pending' ? 'Generating fresh QR...' : 'Waiting for worker...'}
                        </span>
                    )}
                </div>

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
