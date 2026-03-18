"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import LandingPage from "@/components/LandingPage";



import Loader from "@/components/Loader";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  // Use ownerId as secondary key (it can be null/undefined initially)
  const business = useQuery(api.businesses.getBusiness, 
    session?.user?.id ? { ownerId: session.user.id } : "skip"
  );

  useEffect(() => {
    if (status === "authenticated" && session?.user?.id && business !== undefined) {
      if (!business) {
        // No business found -> New user, send to onboarding
        router.push("/onboarding");
      } else if (business.whatsappStatus !== "connected") {
        // Business exists but WA is not connected (disconnected, pending, error)
        router.push("/onboarding/connect");
      } else {
        // For all other statuses (connected, pending, error), go to dashboard
        router.push("/dashboard");
      }
    }
  }, [status, business, session?.user?.id, router]);



  // While loading session, or if authenticated and still fetching business data, show loader
  const isBusinessLoading = status === "authenticated" && session?.user?.id && business === undefined;
  
  if (status === "loading" || isBusinessLoading) {
    return <Loader />;
  }

  // Fallback: If authenticated, keep showing loader until useEffect triggers redirect
  if (status === "authenticated") {
    return <Loader />;
  }



  return (
    <main>
      <LandingPage />
    </main>
  );
}

