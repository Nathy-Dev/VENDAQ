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
  Smartphone
} from 'lucide-react';
import styles from "./onboarding.module.css";
import { clsx } from "clsx";
import { useRouter } from "next/navigation";
import { useVENDAQActions } from "@/hooks/useVENDAQ";
import { useSession } from "next-auth/react";

const features = [
  {
    title: "Say Goodbye to Chat Chaos",
    description: "VENDAQ automatically captures leads from your WhatsApp messages. No more lost customers in buried threads.",
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
  
  const router = useRouter();
  const { createOrUpdateBusiness } = useVENDAQActions();
  const { data: session } = useSession();

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
    
    await createOrUpdateBusiness({
      name: "My Business",
      ownerId,
      onboardingStep: 4,
      whatsappMode: selectedMode,
    });
    
    setStep(4);
  };

  return (
    <div className={styles.onboardingContainer}>
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
                  <p className={styles.description} style={{ fontSize: '0.875rem', marginBottom: '0' }}>Select how VENDAQ connects to your WhatsApp</p>
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
                        Whapi.cloud (Social)
                      </div>
                      {selectedMode === 'unofficial' && <CheckCircle2 size={20} style={{ color: '#10b981' }} />}
                    </div>
                    <p className={styles.modeDesc}>
                      Best for small sellers. Supports status updates, groups, and normal WhatsApp usage.
                    </p>
                    <div className={styles.badgeGroup}>
                      <span className={clsx(styles.badge, styles.badgeDefault)}>Unofficial</span>
                      <span className={clsx(styles.badge, styles.badgePrimary)} style={{ color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)' }}>Risk Safeguarded</span>
                    </div>
                  </button>

                  <button 
                    onClick={() => setSelectedMode('official')}
                    className={clsx(
                      styles.modeButton,
                      selectedMode === 'official' && styles.modeButtonActive
                    )}
                  >
                    <div className={styles.modeHeader}>
                      <div className={styles.modeTitle}>
                        <Zap size={20} style={{ color: '#10b981' }} />
                        Meta Cloud API (Pro)
                      </div>
                      {selectedMode === 'official' && <CheckCircle2 size={20} style={{ color: '#10b981' }} />}
                    </div>
                    <p className={styles.modeDesc}>
                      Maximum reliability and scalability. Authorized by Meta for large-scale automation.
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

                {/* Mock QR/Input area */}
                <div className={styles.qrContainer}>
                  <span style={{ fontSize: '0.625rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {selectedMode === 'unofficial' ? "QR Code Placeholder" : "Token Form Placeholder"}
                  </span>
                </div>

                <button 
                  onClick={() => {
                    // Simulate verification and redirect to dashboard
                    setTimeout(() => {
                      router.push("/dashboard");
                    }, 1500);
                  }}
                  className={styles.primaryButton}
                >
                  Verify Connection
                </button>
                
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
