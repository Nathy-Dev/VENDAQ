"use client";

import { Component, type ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useConvexAuth } from "convex/react";
import Link from "next/link";
import FoundationWorkspace from "./FoundationWorkspace";
import Brand from "./Brand";
import Loader from "./Loader";
import { buttonClass } from "./dashboard-ui";
import styles from "./FoundationWorkspace.module.css";

const protectedRoots = ["/dashboard", "/onboarding", "/pipeline", "/status", "/revenue", "/settings", "/profile"];

export function isFoundationRoute(pathname: string): boolean {
  return protectedRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

// Preserve existing route implementations without mounting their legacy queries
// or send controls. Backend phase guards remain the actual security boundary.
export default function FoundationGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!isFoundationRoute(pathname)) return children;
  return <FoundationErrorBoundary><FoundationAccess /></FoundationErrorBoundary>;
}

function FoundationAccess() {
  const { status, data: session } = useSession();
  const { isAuthenticated } = useConvexAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    // Missing JWT configuration should produce a useful error, not an endless spinner.
    const timer = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timer);
  }, []);

  if (status === "unauthenticated") return <GateMessage title="Sign in to your workspace" description="Your conversations and business records are private. Sign in to pick up where you left off."><Link href="/login" className={buttonClass.primary}>Sign in</Link><Link href="/" className={buttonClass.secondary}>Back to home</Link></GateMessage>;
  if (status === "authenticated" && !session?.user?.id) return <GateMessage title="Please sign in again" description="Your session needs to be renewed to securely open this workspace."><button type="button" className={buttonClass.primary} onClick={() => void signOut({ callbackUrl: "/login" })}>Sign in again</button></GateMessage>;
  if (!isAuthenticated) return timedOut ? <GateMessage title="Workspace connection unavailable" description="Your secure connection couldn't be established. Reload to try again, or ask your administrator to check the authentication setup. No WhatsApp actions have been taken."><button type="button" className={buttonClass.primary} onClick={() => window.location.reload()}>Try again</button><button type="button" className={buttonClass.secondary} onClick={() => void signOut({ callbackUrl: "/login" })}>Sign out</button></GateMessage> : <Loader label="Opening your secure workspace…" />;
  return <FoundationWorkspace />;
}

// Do not expose server error payloads, identifiers, or configuration values in UI.
class FoundationErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <GateMessage title="Workspace unavailable" description="We couldn't load your workspace. The deployment or account migration may need attention. Your existing data has not been removed."><button type="button" className={buttonClass.primary} onClick={() => window.location.reload()}>Retry connection</button><Link href="/" className={buttonClass.secondary}>Back to home</Link></GateMessage>;
    return this.props.children;
  }
}

function GateMessage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className={styles.gate}><section className={styles.gateCard} role="alert"><Link href="/" aria-label="Pipelixr home"><Brand /></Link><h1>{title}</h1><p>{description}</p><div className={styles.actions}>{children}</div></section></main>;
}
