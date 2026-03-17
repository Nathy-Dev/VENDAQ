"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import LandingPage from "@/components/LandingPage";

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
  // (Landing page is fine to flicker briefly or show to unauthenticated users)
  return (
    <main>
      <LandingPage />
    </main>
  );
}
