"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import Image from "next/image";
import QRCode from "react-qr-code";
import { Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { formatDate, titleCase } from "@/lib/workspace-ui";
import { buttonClass, Pill } from "./dashboard-ui";
import { ConfirmDialog, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

export default function ConnectionPanel({ workspace }: { workspace: Workspace }) {
  const connect = useAction(api.connections.connect);
  const refresh = useAction(api.connections.refresh);
  const revoke = useMutation(api.foundation.revokeSession);
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const requestPending = useRef(false);
  const mounted = useRef(true);
  const state = workspace.state;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (state !== "pending") return;
    let active = true;
    const timer = setInterval(async () => {
      if (requestPending.current || document.visibilityState === "hidden") return;
      requestPending.current = true;
      try {
        const result = await refresh({ businessId: workspace.businessId });
        if (active) {
          setQr(result.state === "pending" ? result.qr : null);
          if (result.error) setFeedback({ text: "Pairing needs attention. Refresh the connection or try again later.", error: true });
        }
      } catch {
        if (active) setFeedback({ text: "We couldn't check the connection. You can refresh it manually.", error: true });
      } finally { requestPending.current = false; }
    }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [state, refresh, workspace.businessId]);

  async function pair() {
    if (!acceptedRisk || requestPending.current) return;
    requestPending.current = true;
    setBusy(true); setFeedback(null); setQr(null);
    try {
      const result = await connect({ businessId: workspace.businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk });
      if (!mounted.current) return;
      setQr(result.state === "pending" ? result.qr : null);
      setFeedback(result.error ? { text: "Pairing is unavailable. Check the provider setup with your workspace administrator.", error: true } : { text: result.state === "connected" ? "WhatsApp is connected." : "Pairing started. If a code is available, scan it below." });
    } catch {
      if (mounted.current) setFeedback({ text: "We couldn't start pairing. Your number has not been connected. Please try again later.", error: true });
    } finally {
      requestPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function check() {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true); setFeedback(null);
    try {
      const result = await refresh({ businessId: workspace.businessId });
      if (!mounted.current) return;
      setQr(result.state === "pending" ? result.qr : null);
      setFeedback(result.error ? { text: "Your connection needs attention. Please check the provider setup.", error: true } : { text: `Connection checked: ${titleCase(result.state)}.` });
    } catch {
      if (mounted.current) setFeedback({ text: "We couldn't refresh your connection. Please try again.", error: true });
    } finally {
      requestPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function disconnect() {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true); setFeedback(null);
    try {
      await revoke({ businessId: workspace.businessId });
      if (!mounted.current) return;
      setQr(null); setConfirmation(false);
      setFeedback({ text: "Connection revoked. Stored session credentials are no longer usable." });
    } catch {
      if (mounted.current) setFeedback({ text: "We couldn't revoke this connection. Please try again.", error: true });
    } finally {
      requestPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.connectionTop}>
        <span className={styles.connectionIcon}><Link2 size={19} aria-hidden="true" /></span>
        <div><h2>WhatsApp connection</h2><p>Pair your number. Stay in control of every reply.</p></div>
        <Pill dot tone={state === "connected" ? "positive" : state === "error" ? "danger" : "neutral"}>{titleCase(state)}</Pill>
      </div>
      <div className={styles.riskDisclosure}>
        <p><strong>An unofficial connection, with real risks.</strong> Pipelixr uses Evolution Go, not the official WhatsApp Business API. WhatsApp may restrict or ban a connected number.</p>
        <p>Only connect a number you are authorized to manage. Eligible incoming messages are processed for this workspace and retained for {workspace.retentionDays} days. Opening the app does not send replies, mark messages as read, react, or publish presence.</p>
      </div>
      {state === "revoked" ? <div className={styles.infoBanner}><ShieldCheck size={17} aria-hidden="true" /><p>This connection was revoked. An administrator must reset the session before you can pair again.</p></div> : (
        <>
          {!["connected", "pending", "provisioning"].includes(state) && <label className={styles.checkLabel}><input type="checkbox" checked={acceptedRisk} disabled={busy} onChange={(event) => setAcceptedRisk(event.target.checked)} /><span>I understand the number-ban and retention risks, and authorize processing for this business.</span></label>}
          <div className={styles.actions}>
            {!["connected", "pending", "provisioning"].includes(state) && <button type="button" className={buttonClass.primary} disabled={busy || !acceptedRisk} onClick={() => void pair()}>{busy ? "Connecting…" : "Connect WhatsApp"}</button>}
            <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => void check()}><RefreshCw size={14} aria-hidden="true" />{busy ? "Checking…" : "Refresh status"}</button>
            {["connected", "pending", "provisioning", "error"].includes(state) && <button type="button" className={buttonClass.ghost} disabled={busy} onClick={() => setConfirmation(true)}>Revoke connection</button>}
          </div>
          {state === "pending" && (qr ? <div className={styles.qr}>{qr.startsWith("data:image/png;base64,") ? <Image src={qr} alt="WhatsApp pairing QR code" width={224} height={224} unoptimized /> : <QRCode value={qr} size={224} title="WhatsApp pairing QR code" />}<p>In WhatsApp, open <strong>Linked devices → Link a device</strong> and scan this code. Keep it private; it is not stored in your browser.</p></div> : <p className={styles.helper}>Waiting for a pairing code. Status refreshes every 15 seconds while this page is visible.</p>)}
          {state === "provisioning" && <p className={styles.helper}>The connection is being prepared. Refresh the status in a moment.</p>}
        </>
      )}
      {workspace.lastHealthAt && <p className={styles.helper}>Last checked {formatDate(workspace.lastHealthAt, workspace.timezone)}</p>}
      {workspace.lastError && <p className={styles.helper}>The provider reported a connection issue. Refresh the status or ask your administrator to check the setup.</p>}
      {feedback && <div className={styles.actions}><Notice feedback={feedback} /></div>}
      <ConfirmDialog open={confirmation} onClose={() => setConfirmation(false)} onConfirm={() => void disconnect()} busy={busy} title="Revoke this connection?" description="This disables the session credentials and stops processing through this connection. Your retained records remain subject to the retention policy. Reconnecting requires an administrator to reset the session." confirmLabel="Revoke connection" />
    </section>
  );
}
