"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Image from "next/image";
import QRCode from "react-qr-code";
import { Link2, ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { formatDate, titleCase } from "@/lib/workspace-ui";
import { buttonClass, Pill } from "./dashboard-ui";
import { ConfirmDialog, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";
import MetaWhatsAppConnection from "./MetaWhatsAppConnection";

export default function ConnectionPanel({ workspace, embedded = false }: { workspace: Workspace; embedded?: boolean }) {
  const config = useQuery(api.metaConnections.config, { businessId: workspace.businessId });
  if (workspace.connectionProvider === "meta" || (config && (!workspace.connectionProvider || (workspace.connectionProvider === "evolution" && workspace.state === "disconnected")))) {
    return <MetaWhatsAppConnection key={workspace.businessId} workspace={workspace} config={config ?? null} embedded={embedded} />;
  }
  return <EvolutionConnectionPanel workspace={workspace} embedded={embedded} />;
}

function EvolutionConnectionPanel({ workspace, embedded }: { workspace: Workspace; embedded: boolean }) {
  const connect = useAction(api.connections.connect);
  const refresh = useAction(api.connections.refresh);
  const resetRevoked = useAction(api.connections.resetRevoked);
  const revoke = useMutation(api.foundation.revokeSession);
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [pairing, setPairing] = useState<FunctionReturnType<typeof api.connections.refresh> | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<"qr" | "phone" | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const requestPending = useRef(false);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const methodId = useId();
  const state = workspace.state;
  const activeMethod = pairing?.pairingMethod ?? "qr";
  const method = selectedMethod ?? activeMethod;
  const canPair = state !== "connected" && state !== "revoked";
  const isPending = state === "pending" && pairing?.state !== "connected";
  const qr = isPending && method === "qr" ? pairing?.qr : null;
  const pairingCode = isPending && method === "phone" ? pairing?.pairingCode : null;
  const codeExpiresAt = pairing?.pairingCodeExpiresAt;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (state !== "pending") return;
    let active = true;
    let polling = false;
    async function poll() {
      if (polling || requestPending.current || document.visibilityState === "hidden") return;
      polling = true;
      const version = requestVersion.current;
      try {
        const result = await refresh({ businessId: workspace.businessId });
        if (active && version === requestVersion.current) {
          setPairing(result);
          if (result.error) setFeedback({ text: connectionErrorMessage(result.error), error: true });
        }
      } catch {
        if (active && version === requestVersion.current) setFeedback({ text: "We couldn't check the connection. We'll try again automatically.", error: true });
      } finally { polling = false; }
    }
    void poll();
    const timer = setInterval(() => void poll(), 15000);
    return () => { active = false; clearInterval(timer); };
  }, [state, refresh, workspace.businessId]);

  useEffect(() => {
    if (!codeExpiresAt) return;
    const timer = setTimeout(() => {
      setPairing((current) => current?.pairingCodeExpiresAt === codeExpiresAt ? { ...current, pairingCode: undefined, pairingCodeExpiresAt: undefined } : current);
    }, Math.max(0, codeExpiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [codeExpiresAt]);

  function beginRequest() {
    requestPending.current = true;
    requestVersion.current += 1;
    setBusy(true);
    setFeedback(null);
  }

  async function pair() {
    if (!acceptedRisk || requestPending.current || !canPair) return;
    if (method === "phone" && !/^\+[1-9][0-9]{6,14}$/.test(phoneNumber.trim().replace(/[ ()-]/g, ""))) {
      setFeedback({ text: connectionErrorMessage("INVALID_PAIRING_PHONE"), error: true });
      return;
    }
    beginRequest();
    setPairing(null);
    try {
      const result = await connect({ businessId: workspace.businessId, disclosureVersion: "phase-1-2026-10-27", acceptedRisk, method, ...(method === "phone" ? { phoneNumber } : {}) });
      if (!mounted.current) return;
      setPairing(result);
      setFeedback(result.error ? { text: connectionErrorMessage(result.error), error: true } : result.state === "connected" ? { text: "WhatsApp is connected." } : null);
    } catch {
      if (mounted.current) setFeedback({ text: "We couldn't start pairing. Your number has not been connected. Please try again later.", error: true });
    } finally {
      requestPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function disconnect() {
    if (requestPending.current) return;
    beginRequest();
    try {
      await revoke({ businessId: workspace.businessId });
      if (!mounted.current) return;
      setPairing(null); setPhoneNumber(""); setConfirmation(false);
      setFeedback({ text: "Connection revoked. Stored session credentials are no longer usable." });
    } catch {
      if (mounted.current) setFeedback({ text: "We couldn't revoke this connection. Please try again.", error: true });
    } finally {
      requestPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function resetConnection() {
    if (requestPending.current) return;
    beginRequest();
    setPairing(null);
    try {
      const result = await resetRevoked({ businessId: workspace.businessId });
      if (!mounted.current) return;
      setFeedback(result.error
        ? { text: connectionErrorMessage(result.error), error: true }
        : { text: "The old connection was cleared safely. Accept the risk notice and connect WhatsApp again." });
    } catch {
      if (mounted.current) setFeedback({ text: "We couldn't reset this connection safely. Please try again later.", error: true });
    } finally {
      requestPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className={embedded ? styles.setupPanel : styles.card}>
      <div className={styles.connectionTop}>
        <span className={styles.connectionIcon}><Link2 size={19} aria-hidden="true" /></span>
        <div><h2>WhatsApp connection</h2><p>Pair a number you are authorized to manage. Reply permissions are configured separately.</p></div>
        <Pill dot tone={state === "connected" ? "positive" : state === "error" ? "danger" : "neutral"}>{titleCase(state)}</Pill>
      </div>
      <div className={styles.riskDisclosure}>
        <p>Pipelixr uses Evolution Go. Auto-replies are off by default and rate-limited when enabled.</p>
        <p>Eligible incoming messages are kept for {workspace.retentionDays} days. Auto-replies require separate customer or group consent.</p>
      </div>
      {state === "revoked" ? <><div className={styles.infoBanner}><ShieldCheck size={17} aria-hidden="true" /><p>This connection was revoked. Reset it to create fresh credentials and pair again. The reset stays blocked if the old provider instance still exists.</p></div><div className={styles.actions}><button type="button" className={buttonClass.primary} disabled={busy} onClick={() => void resetConnection()}>{busy ? "Resetting…" : "Reset connection"}</button></div></> : (
        <>
          {canPair && <>
            <fieldset className={styles.pairingMethods} disabled={busy}>
              <legend>Pairing method</legend>
              <div>
                <label><input type="radio" name={methodId} checked={method === "qr"} onChange={() => { setSelectedMethod("qr"); setFeedback(null); }} />Scan QR code</label>
                <label><input type="radio" name={methodId} checked={method === "phone"} onChange={() => { setSelectedMethod("phone"); setFeedback(null); }} />Use pairing code</label>
              </div>
            </fieldset>
            {method === "phone" && <label className={`${styles.field} ${styles.pairingPhone}`}>
              WhatsApp phone number
              <input className={styles.input} type="tel" autoComplete="tel" placeholder="+234 800 000 0000" maxLength={32} value={phoneNumber} disabled={busy} onChange={(event) => setPhoneNumber(event.target.value)} aria-describedby={`${methodId}-phone-help`} />
              <span id={`${methodId}-phone-help`} className={styles.fieldHelp}>Include the country code, for example +234.</span>
            </label>}
            <label className={styles.checkLabel}><input type="checkbox" checked={acceptedRisk} disabled={busy} onChange={(event) => setAcceptedRisk(event.target.checked)} /><span>I understand the risks and authorize Pipelixr to process messages for this business.</span></label>
          </>}
          <div className={styles.actions}>
            {canPair && !qr && <button type="button" className={buttonClass.primary} disabled={busy || !acceptedRisk || (method === "phone" && !phoneNumber.trim())} onClick={() => void pair()}>{method === "phone" ? pairingCode ? "Get a new pairing code" : "Get pairing code" : "Show QR code"}</button>}
            {["connected", "pending", "provisioning", "error"].includes(state) && <button type="button" className={buttonClass.ghost} disabled={busy} onClick={() => setConfirmation(true)}>Revoke connection</button>}
          </div>
          {qr && <div className={styles.qr}>{qr.startsWith("data:image/png;base64,") ? <Image src={qr} alt="WhatsApp pairing QR code" width={224} height={224} unoptimized /> : <QRCode value={qr} size={224} title="WhatsApp pairing QR code" />}<p>In WhatsApp, open <strong>Linked devices → Link a device</strong> and scan this code. Keep it private.</p></div>}
          {pairingCode && <div className={styles.qr} aria-live="polite"><code className={styles.pairingCode}>{pairingCode}</code><p>In WhatsApp, open <strong>Linked devices → Link a device → Link with phone number instead</strong> and enter this code. Keep it private.</p></div>}
          {busy && !qr && !pairingCode && canPair && <p className={styles.helper} role="status">Working on your connection…</p>}
          {isPending && !busy && method === activeMethod && !qr && !pairingCode && <p className={styles.helper} role="status">{method === "phone" ? "No active pairing code. Request a new one if needed." : "Waiting for a QR code. The connection status updates automatically."}</p>}
          {state === "provisioning" && <p className={styles.helper}>The connection is being prepared. Status updates automatically.</p>}
        </>
      )}
      {workspace.lastHealthAt && <p className={styles.helper}>Last checked {formatDate(workspace.lastHealthAt, workspace.timezone)}</p>}
      {workspace.lastError && <p className={styles.helper}>The provider reported a connection issue. If it persists, ask your administrator to check the setup.</p>}
      {feedback && <div className={styles.actions}><Notice feedback={feedback} /></div>}
      <ConfirmDialog open={confirmation} onClose={() => setConfirmation(false)} onConfirm={() => void disconnect()} busy={busy} title="Revoke this connection?" description="This disables the session credentials and stops processing through this connection. Your retained records remain subject to the retention policy. Reconnecting requires an administrator to reset the session." confirmLabel="Revoke connection" />
    </section>
  );
}

function connectionErrorMessage(code: string): string {
  if (code === "INVALID_PAIRING_PHONE") return "Enter your WhatsApp number with its country code, for example +234 800 000 0000.";
  if (code === "PAIRING_CODE_UNAVAILABLE") return "The provider didn’t return a pairing code. Try again or scan a QR code instead.";
  if (code === "PAIRING_ARTIFACT_UNAVAILABLE") return "We couldn’t retrieve the code. Request a new one.";
  if (code === "CONNECTION_IN_PROGRESS") return "Another pairing request is in progress. Status updates automatically.";
  if (code === "QR_TIMEOUT") return "This pairing attempt timed out. Request a new code to try again.";
  if (code === "PROVIDER_QUALIFICATION_REQUIRED") return "WhatsApp connection is temporarily unavailable while the provider setup is being verified.";
  if (code === "CONNECTION_SECURITY_UNAVAILABLE") return "Secure WhatsApp connection setup needs administrator attention. Your number has not been connected.";
  if (code === "PROVIDER_AUTH_FAILED") return "The WhatsApp provider rejected the connection credentials. Please try again after the provider setup is updated.";
  if (["PROVIDER_REQUEST_FAILED", "PROVIDER_UNAVAILABLE"].includes(code)) return "The WhatsApp provider could not be reached. Please try again shortly.";
  if (code === "PROVIDER_INSTANCE_UNRESOLVED") return "The earlier connection attempt needs administrator review before it can be retried safely.";
  if (code === "PROVIDER_INSTANCE_STILL_EXISTS") return "The old WhatsApp instance still exists at the provider, so Pipelixr did not replace its credentials. An administrator must reconcile it first.";
  if (["SESSION_RESET_CONFLICT", "SESSION_RESET_NOT_ALLOWED"].includes(code)) return "The connection changed while it was being reset. Refresh the page and try again.";
  return "WhatsApp pairing is unavailable right now. Please try again shortly.";
}
