"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import LandingPage from "@/components/LandingPage";
import authStyles from "./Auth.module.css";


export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  // Use ownerId as secondary key (it can be null/undefined initially)
  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  useEffect(() => {
    if (status === "authenticated" && business !== undefined) {
      if (!business) {
        // No business found -> New user, send to onboarding
        router.push("/onboarding");
      } else if (business.whatsappStatus === "disconnected") {
        // Business exists but WA is disconnected
        router.push("/onboarding/connect");
      } else if (business.whatsappStatus === "connected") {
        // All good, go to dashboard
        router.push("/dashboard");
      }
    }
  }, [session, status, business, router]);

  // While loading session or business, or if not authenticated, show landing page
  // We avoid showing the full landing page to authenticated users while waiting for redirection results
  if (status === "loading" || (status === "authenticated" && business === undefined)) {
    return (
      <div className={authStyles.authPage}>
        <div className={authStyles.backgroundGlow}>
          <div className={authStyles.glow1} />
          <div className={authStyles.glow2} />
        </div>
        <div className={authStyles.spinner} style={{ width: '40px', height: '40px', borderWidth: '3px' }} />
      </div>
    );
  }

  if (status === "authenticated") {
    return null;
  }

  return (
    <main>
      <LandingPage />
    </main>
  );
}

