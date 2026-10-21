"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL || "https://dummy.convex.cloud"
);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ConvexProvider client={convex}>{children}</ConvexProvider>
    </SessionProvider>
  );
}
