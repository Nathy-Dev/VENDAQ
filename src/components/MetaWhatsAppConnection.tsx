"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Link2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Workspace } from "@/types/workspace";
import { titleCase } from "@/lib/workspace-ui";
import { buttonClass, Pill } from "./dashboard-ui";
import { ConfirmDialog, Notice, type Feedback } from "./WorkspaceFeedback";
import styles from "./FoundationWorkspace.module.css";

type Config = NonNullable<FunctionReturnType<typeof api.metaConnections.config>>;
type Assets = { wabaId: string; phoneId: string };
const coexistenceExtras = {
  featureType: "whatsapp_business_app_onboarding",
  sessionInfoVersion: "3",
  version: "v4",
} as const;
const metaSdkVersion = "v27.0";
type MetaSdk = {
  init: (config: { appId: string; version: string; xfbml: boolean; autoLogAppEvents: boolean }) => void;
  login: (callback: (response: { authResponse?: { code?: string } }) => void, options: { config_id: string; response_type: "code"; override_default_response_type: boolean; extras: string }) => void;
};
const origins = new Set(["https://www.facebook.com", "https://web.facebook.com", "https://m.facebook.com"]);
const assetId = /^[1-9]\d{4,29}$/;

function sdk() { return (window as Window & { FB?: MetaSdk }).FB; }

export function parseMetaSignupMessage(event: Pick<MessageEvent, "origin" | "data">): Assets | "cancel" | "error" | null {
  if (!origins.has(event.origin) || typeof event.data !== "string" || event.data.length > 10_000) return null;
  try {
    const eventData = JSON.parse(event.data);
    if (eventData?.type !== "WA_EMBEDDED_SIGNUP") return null;
    if (eventData.event === "CANCEL") return "cancel";
    if (["ERROR", "FINISH"].includes(eventData.event)) return "error";
    if (eventData.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") return null;
    const { waba_id: wabaId, phone_number_id: phoneId } = eventData.data ?? {};
    if (typeof wabaId !== "string" || !assetId.test(wabaId) || typeof phoneId !== "string" || !assetId.test(phoneId)) return "error";
    return { wabaId, phoneId };
  } catch { return null; }
}

export default function MetaWhatsAppConnection({ workspace, config, embedded }: { workspace: Workspace; config: Config | null; embedded: boolean }) {
  const begin = useAction(api.metaConnections.begin);
  const complete = useAction(api.metaConnections.complete);
  const cancel = useMutation(api.metaConnections.cancel);
  const disconnect = useMutation(api.metaConnections.disconnect);
  const [accepted, setAccepted] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const active = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  const businessId = workspace.businessId;
  const connected = workspace.state === "connected";
  const provisioning = workspace.state === "provisioning" || workspace.state === "pending";

  useEffect(() => () => { cleanup.current?.(); }, []);

  async function prepare() {
    if (!accepted || !ready || active.current) return;
    active.current = true;
    setBusy(true);
    setFeedback(null);
    try { setAttempt(await begin({ businessId, accepted })); }
    catch { setFeedback({ text: "Could not start signup. Close any other signup window or wait for that attempt to expire, then try again.", error: true }); }
    finally { active.current = false; setBusy(false); }
  }

  function launch() {
    const facebook = sdk();
    if (!facebook || !config || !attempt || active.current) return;
    active.current = true;
    setBusy(true);
    setFeedback(null);
    let assets: Assets | null = null;
    let code: string | undefined;
    let settled = false;
    let timer: number | undefined;

    function clear() {
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      cleanup.current = null;
    }

    function finish(message?: string) {
      active.current = false;
      setBusy(false);
      setAttempt(null);
      setFeedback(message ? { text: message, error: true } : null);
    }

    function abort(message: string) {
      if (settled || !attempt) return;
      clear();
      void cancel({ businessId, attempt }).catch(() => null).finally(() => finish(message));
    }

    function submit() {
      if (settled || !assets || !code || !attempt) return;
      clear();
      void complete({ businessId, attempt, code, ...assets }).then((result) => finish(result.connected ? undefined : signupError(result.error))).catch(() => finish("Could not verify the Meta connection. Reopen signup and try again."));
    }

    function onMessage(event: MessageEvent) {
      const message = parseMetaSignupMessage(event);
      if (message === "cancel") abort("Signup was cancelled. Your WhatsApp Business app is still available.");
      else if (message === "error") abort("Select your existing WhatsApp Business app number in Meta, rather than creating a new number.");
      else if (message) { assets = message; submit(); }
    }

    cleanup.current = clear;
    window.addEventListener("message", onMessage);
    timer = window.setTimeout(() => abort("Meta did not finish signup. If the popup was blocked, allow popups and start again."), 9 * 60_000);
    try {
      facebook.login((response) => {
        if (settled) return;
        code = response.authResponse?.code;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => abort(code ? "Meta did not return the WhatsApp account details. Restart signup." : "Meta signup was closed or cancelled."), 4_000);
        submit();
      }, { config_id: config.configId, response_type: "code", override_default_response_type: true, extras: JSON.stringify(coexistenceExtras) });
    } catch { abort("Could not open Meta. Allow popups and try again."); }
  }

  async function stop() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    try { await disconnect({ businessId }); setAttempt(null); setConfirm(false); setFeedback(null); }
    catch { setFeedback({ text: "Could not disconnect. Try again or disconnect in the WhatsApp Business app.", error: true }); }
    finally { active.current = false; setBusy(false); }
  }

  return <section className={embedded ? styles.setupPanel : styles.card}>
    {config && !connected && <Script id="meta-whatsapp-sdk" src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" crossOrigin="anonymous" onReady={() => {
      const facebook = sdk();
      if (!facebook) { setFeedback({ text: "Meta could not load. Allow the Facebook SDK, then reload this page.", error: true }); return; }
      try { facebook.init({ appId: config.appId, version: metaSdkVersion, xfbml: false, autoLogAppEvents: false }); setReady(true); }
      catch { setFeedback({ text: "Meta could not initialize. Ask your administrator to verify the signup configuration.", error: true }); }
    }} onError={() => setFeedback({ text: "Meta could not load. Allow the Facebook SDK, then reload this page.", error: true })} />}
    <div className={styles.connectionTop}><span className={styles.connectionIcon}><Link2 size={19} aria-hidden="true" /></span><div><h2>WhatsApp Business connection</h2><p>Connect through Meta and keep using the same number in the WhatsApp Business app.</p></div><Pill dot tone={connected ? "positive" : workspace.state === "error" ? "danger" : "neutral"}>{titleCase(workspace.state)}</Pill></div>
    {workspace.meta && connected && <div className={styles.infoBanner} role="status"><p><strong>{workspace.meta.displayPhone}</strong> · Contacts: {titleCase(workspace.meta.contactsState)} · History: {workspace.meta.historyState === "declined" ? "Not shared" : workspace.meta.historyState === "complete" ? "Received by Pipelixr" : titleCase(workspace.meta.historyState)}{workspace.meta.historyState !== "complete" && workspace.meta.historyProgress !== undefined ? ` (${workspace.meta.historyProgress}%)` : ""}. Keep the WhatsApp Business app open during sync.</p></div>}
    {!connected && <div className={styles.riskDisclosure}><p>Each workspace connects one Meta Messaging account and one existing WhatsApp Business number. Meta may unlink companion devices during setup; group chats and statuses do not sync.</p><p>Meta lets you choose whether to share your chat history. Pipelixr retains eligible messages for {workspace.retentionDays} days and never auto-replies to imported history.</p></div>}
    {!connected && !!config && !attempt && !provisioning && <label className={styles.checkLabel}><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={busy} /><span>I manage this number and authorize Pipelixr to process its WhatsApp messages.</span></label>}
    <div className={styles.actions}>
      {!connected && !!config && (attempt ? <button type="button" className={buttonClass.primary} onClick={launch} disabled={!ready || busy}>Continue with Meta</button> : !provisioning && <button type="button" className={buttonClass.primary} onClick={() => void prepare()} disabled={!accepted || !ready || busy}>Connect WhatsApp Business</button>)}
      {(connected || provisioning || workspace.state === "error") && <button type="button" className={buttonClass.ghost} onClick={() => setConfirm(true)} disabled={busy}>{provisioning ? "Cancel setup" : "Disconnect from Pipelixr"}</button>}
    </div>
    {busy && <p className={styles.helper} role="status">Working on your Meta connection…</p>}
    {!config && !connected && <p className={styles.helper}>Meta signup is not currently enabled for this deployment.</p>}
    {!ready && config && !connected && <p className={styles.helper}>If Meta does not load, <a href="/onboarding/connect">open the connection page directly</a> and allow popups.</p>}
    {workspace.lastError && !feedback && <p className={styles.helper} role="status">{signupError(workspace.lastError)}</p>}
    {feedback && <Notice feedback={feedback} />}
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void stop()} busy={busy} title="Disconnect from Pipelixr?" description="Pipelixr stops syncing and sending. To remove the official link as well, open WhatsApp Business → Settings → Account → Business Platform → Disconnect Account. Your number stays in the WhatsApp Business app." confirmLabel="Disconnect" />
  </section>;
}

function signupError(code?: string) {
  if (code === "META_ASSET_ALREADY_BOUND") return "This Meta Messaging account or phone is already connected to another workspace.";
  if (code === "META_DISCONNECT_PREVIOUS_NUMBER") return "Disconnect the previous number in the WhatsApp Business app before connecting a different one.";
  if (code === "META_COEXISTENCE_REQUIRED" || code === "META_NUMBER_NOT_IN_ACCOUNT") return "Meta did not verify this number as an existing WhatsApp Business app number in the selected account.";
  if (code === "META_AUTH_EXPIRED" || code === "META_OFFBOARDED") return "The Meta connection ended. Reconnect with Meta when you are ready.";
  if (code === "META_SIGNUP_EXPIRED") return "The signup attempt expired. Start a fresh connection.";
  return "Pipelixr could not verify the Meta connection. Try again or ask your administrator to check the setup.";
}
