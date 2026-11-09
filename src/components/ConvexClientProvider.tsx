"use client";

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ReactNode, useCallback, useMemo } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import FoundationGate from "./FoundationGate";

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL || "https://dummy.convex.cloud"
);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useConvexSession}><FoundationGate>{children}</FoundationGate></ConvexProviderWithAuth>
    </SessionProvider>
  );
}

function useConvexSession() {
  const { status, data } = useSession();
  const subject = data?.user?.id;
  const fetchAccessToken = useCallback(async () => {
    if (status !== "authenticated" || !subject) return null;
    try {
      const response = await fetch("/api/auth/convex-token", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) return null;
      const result = await response.json() as { token?: string };
      return result.token ?? null;
    } catch { return null; }
  }, [status, subject]);
  return useMemo(() => ({ isLoading: status === "loading", isAuthenticated: status === "authenticated" && Boolean(subject), fetchAccessToken }), [status, subject, fetchAccessToken]);
}
