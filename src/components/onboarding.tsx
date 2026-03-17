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
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden relative">
        {/* Progress Bar */}
        <div className="absolute top-0 left-0 w-full h-1 bg-slate-100">
          <motion.div 
            className="h-full bg-emerald-500"
            initial={{ width: "0%" }}
            animate={{ width: `${((step > 2 ? step : featureIndex + 1) / 5) * 100}%` }}
          />
        </div>

        <div className="p-8">
          <AnimatePresence mode="wait">
            {step < 3 ? (
              <motion.div 
                key={`feature-${featureIndex}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col items-center text-center space-y-6"
              >
                <div 
                  className="w-20 h-20 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: `${features[featureIndex].color}20` }}
                >
                  {React.createElement(features[featureIndex].icon, { 
                    size: 40, 
                    style: { color: features[featureIndex].color } 
                  })}
                </div>
                <h1 className="text-2xl font-bold text-slate-900">{features[featureIndex].title}</h1>
                <p className="text-slate-600 leading-relaxed">
                  {features[featureIndex].description}
                </p>
                <button 
                  onClick={nextFeature}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-200"
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
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-bold text-slate-900">Choose Your Gateway</h1>
                  <p className="text-slate-500 text-sm">Select how VENDAQ connects to your WhatsApp</p>
                </div>

                <div className="space-y-4">
                  <button 
                    onClick={() => setSelectedMode('unofficial')}
                    className={clsx(
                      "w-full p-4 rounded-2xl border-2 text-left transition-all relative overflow-hidden",
                      selectedMode === 'unofficial' ? "border-emerald-500 bg-emerald-50" : "border-slate-100 hover:border-emerald-200"
                    )}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2 font-bold text-slate-800">
                        <Smartphone size={20} className="text-emerald-500" />
                        Whapi.cloud (Social)
                      </div>
                      {selectedMode === 'unofficial' && <CheckCircle2 size={20} className="text-emerald-500" />}
                    </div>
                    <p className="text-xs text-slate-500 leading-normal">
                      Best for small sellers. Supports status updates, groups, and normal WhatsApp usage.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <span className="text-[10px] bg-slate-200 px-2 py-0.5 rounded-full text-slate-700">Unofficial</span>
                      <span className="text-[10px] bg-amber-100 px-2 py-0.5 rounded-full text-amber-700">Risk Safeguarded</span>
                    </div>
                  </button>

                  <button 
                    onClick={() => setSelectedMode('official')}
                    className={clsx(
                      "w-full p-4 rounded-2xl border-2 text-left transition-all relative overflow-hidden",
                      selectedMode === 'official' ? "border-emerald-500 bg-emerald-50" : "border-slate-100 hover:border-emerald-200"
                    )}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2 font-bold text-slate-800">
                        <Zap size={20} className="text-emerald-500" />
                        Meta Cloud API (Pro)
                      </div>
                      {selectedMode === 'official' && <CheckCircle2 size={20} className="text-emerald-500" />}
                    </div>
                    <p className="text-xs text-slate-500 leading-normal">
                      Maximum reliability and scalability. Authorized by Meta for large-scale automation.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <span className="text-[10px] bg-emerald-100 px-2 py-0.5 rounded-full text-emerald-700">Official</span>
                      <span className="text-[10px] bg-blue-100 px-2 py-0.5 rounded-full text-blue-700">High Scalability</span>
                    </div>
                  </button>
                </div>

                {selectedMode === 'unofficial' && (
                  <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex gap-3">
                    <ShieldAlert size={18} className="text-amber-500 shrink-0" />
                    <p className="text-[10px] text-amber-800 leading-normal">
                      <strong>Guardians enabled:</strong> We implement human-like typing delays and rate limits to keep your account safe in unofficial mode.
                    </p>
                  </div>
                )}

                <button 
                  disabled={!selectedMode}
                  onClick={handleConfirmMode}
                  className="w-full bg-slate-900 disabled:bg-slate-300 text-white font-semibold py-4 rounded-xl transition-all shadow-lg"
                >
                  Confirm & Connect
                </button>
              </motion.div>
            ) : (
              <motion.div 
                key="connection"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-6"
              >
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                    <Smartphone size={32} />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl font-bold">Connect WhatsApp</h1>
                  <p className="text-slate-500 text-sm">
                    {selectedMode === 'unofficial' 
                      ? "Scan the QR code with your WhatsApp Link Device feature." 
                      : "Enter your Meta Developer tokens to establish connection."}
                  </p>
                </div>

                {/* Mock QR/Input area */}
                <div className="aspect-square w-48 bg-slate-100 rounded-2xl mx-auto flex items-center justify-center border-2 border-dashed border-slate-200">
                  <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">
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
                  className="w-full bg-emerald-500 text-white font-semibold py-4 rounded-xl shadow-lg"
                >
                  Verify Connection
                </button>
                
                <button 
                  onClick={() => setStep(3)}
                  className="text-slate-400 text-sm font-medium hover:text-slate-600"
                >
                  Go Back
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      
      {/* Background decoration */}
      <div className="fixed top-0 left-0 w-full h-full -z-10 bg-slate-50 opacity-50">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-100 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-50 rounded-full blur-[120px]" />
      </div>
    </div>
  );
}
