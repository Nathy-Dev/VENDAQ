"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import { api } from "../../convex/_generated/api";
import Brand from "./Brand";
import { buttonClass } from "./dashboard-ui";
import styles from "./FoundationWorkspace.module.css";

export default function LegalAcceptanceGate({ children }: { children: React.ReactNode }) {
  const status = useQuery(api.compliance.legalStatus, {});
  const accept = useMutation(api.compliance.acceptLegal);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (status === undefined) return <main className={styles.gate}><section className={styles.gateCard}><Brand /><p className={styles.loadingLabel}>Checking legal documents…</p></section></main>;
  if (status.ready) return children;

  async function continueToWorkspace() {
    if (!confirmed || busy) return;
    setBusy(true); setError("");
    try {
      await accept({ documents: ["terms", "privacy", "acceptable_use", "dpa"], method: "account_gate" });
    } catch {
      setError("We couldn't record your acceptance. Please retry before using the workspace.");
      setBusy(false);
    }
  }

  return <main className={styles.gate}><section className={`${styles.gateCard} ${styles.legalGate}`} aria-labelledby="legal-acceptance-title">
    <Brand />
    <span className={styles.gateIcon}><FileCheck2 size={22} /></span>
    <h1 id="legal-acceptance-title">Review the rules for your workspace</h1>
    <p>Pipelixr processes customer conversations on your business&apos;s instructions. Before continuing, confirm the current legal and data-processing terms.</p>
    <ul className={styles.legalLinks}>
      <li><Link href="/legal/terms" target="_blank">Terms of Service</Link></li>
      <li><Link href="/legal/privacy" target="_blank">Privacy Notice</Link></li>
      <li><Link href="/legal/acceptable-use" target="_blank">Acceptable Use Policy</Link></li>
      <li><Link href="/legal/dpa" target="_blank">Seller Data Processing Agreement</Link></li>
    </ul>
    <label className={styles.legalCheck}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I am authorized to act for this business, I have read and accept these documents, and I will only connect and process customer data I am permitted to use.</span></label>
    <div className={styles.infoBanner}><ShieldCheck size={17} /><p>Acceptance is versioned and recorded. Material updates will require acceptance again.</p></div>
    {error && <p className={styles.gateError} role="alert">{error}</p>}
    <button type="button" className={buttonClass.primary} disabled={!confirmed || busy} onClick={() => void continueToWorkspace()}>{busy ? "Recording acceptance…" : "Accept and continue"}</button>
  </section></main>;
}
