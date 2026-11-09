"use client";

import { useEffect, useId, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useAction } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Eye, EyeOff, MessageCircle, Check, CircleAlert } from "lucide-react";
import { api } from "../../convex/_generated/api";
import Brand from "./Brand";
import styles from "../app/Auth.module.css";

export default function AuthScreen({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const router = useRouter();
  const { status } = useSession();
  const createUser = useAction(api.auth.createUser);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"credentials" | "google" | null>(null);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const errorId = `${id}-error`;
  const passwordHintId = `${id}-password-hint`;

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (signup && (password.length < 12 || new TextEncoder().encode(password).byteLength > 72)) { setError("Use at least 12 characters and no more than 72 bytes for your password."); return; }
    if (signup && name.trim().length < 2) { setError("Enter a name with at least two characters."); return; }
    setBusy("credentials");
    let accountCreated = created;
    try {
      const address = email.trim().toLowerCase();
      if (signup && !accountCreated) { await createUser({ name: name.trim(), email: address, password }); accountCreated = true; setCreated(true); }
      const result = await signIn("credentials", { email: address, password, redirect: false });
      if (!result || result.error) setError(accountCreated ? "Your account is created, but we couldn't sign you in. Try signing in with your new credentials." : "We couldn't sign you in. Check your email and password, then try again.");
      else router.replace("/dashboard");
    } catch { setError(accountCreated ? "Your account is created. Sign in with your new credentials to continue." : signup ? "We couldn't create your account. Check your details, try signing in if you already have an account, or retry shortly." : "Sign-in is temporarily unavailable. Please try again shortly."); }
    finally { setBusy(null); }
  }

  async function google() {
    if (busy) return;
    setBusy("google"); setError("");
    try { await signIn("google", { callbackUrl: "/dashboard" }); }
    catch { setError("Google sign-in is unavailable. Please use your email instead."); setBusy(null); }
  }

  return (
    <div className={styles.authPage}>
      <a href="#auth-form" className="skip-link">Skip to sign-in form</a>
      <header className={styles.topbar}><Link href="/" aria-label="Pipelixr home"><Brand /></Link><Link href="/" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />Back to home</Link></header>
      <main className={styles.authLayout}>
        <aside className={styles.story} aria-label="About your workspace">
          <span className={styles.eyebrow}>A little more clarity. Every day.</span>
          <h2>Less noise.<br />More follow-through.</h2>
          <p>Your conversations, next steps, and orders. Together in a workspace that stays out of your way.</p>
          <div className={styles.storyPreview} aria-hidden="true"><div className={styles.previewHeading}><MessageCircle size={19} strokeWidth={1.7} /><strong>Everything in its place.</strong></div><div className={styles.previewRow}><span>01</span><div><strong>Keep the conversation close</strong><p>A clean inbox for the details that matter.</p></div></div><div className={styles.previewRow}><span>02</span><div><strong>Know your next step</strong><p>Review a draft. Send it yourself.</p></div></div><div className={styles.previewRow}><Check size={17} /><div><strong>Record the outcome</strong><p>Real orders. Clearly recorded.</p></div></div></div>
          <p className={styles.storyNote}>Built for the way you already sell. Not another noisy dashboard.</p>
        </aside>
        <div className={styles.formColumn}>
          <section id="auth-form" className={styles.card} aria-labelledby={`${id}-title`}>
            <div className={styles.header}><span className={styles.eyebrow}>{signup ? "Your next chapter" : "Right where you left off"}</span><h1 id={`${id}-title`}>{signup ? "Make room for better work." : "Welcome back."}</h1><p>{signup ? "Create an account to organize your WhatsApp business." : "Sign in to your Pipelixr workspace."}</p></div>
            <button type="button" disabled={busy !== null} onClick={() => void google()} className={styles.googleBtn}><span className={styles.googleMark} aria-hidden="true">G</span>{busy === "google" ? "Opening Google…" : "Continue with Google"}</button>
            <div className={styles.divider}><span>or use your email</span></div>
            <form onSubmit={(event) => void submit(event)} className={styles.form} aria-busy={busy === "credentials"}>
              {signup && <div className={styles.inputGroup}><label htmlFor={`${id}-name`}>Your name</label><input id={`${id}-name`} name="name" type="text" autoComplete="name" placeholder="Full name" required minLength={2} maxLength={100} disabled={busy !== null || created} value={name} onChange={(event) => setName(event.target.value)} className={styles.input} /></div>}
              <div className={styles.inputGroup}><label htmlFor={`${id}-email`}>Email</label><input id={`${id}-email`} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" required maxLength={254} disabled={busy !== null || created} value={email} onChange={(event) => setEmail(event.target.value)} className={styles.input} /></div>
              <div className={styles.inputGroup}><label htmlFor={`${id}-password`}>Password</label><div className={styles.passwordWrapper}><input id={`${id}-password`} name="password" type={showPassword ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} placeholder={signup ? "Create a strong password" : "Your password"} required minLength={signup ? 12 : 1} disabled={busy !== null} value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={signup ? passwordHintId : undefined} className={styles.input} /><button type="button" className={styles.passwordToggle} disabled={busy !== null} onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button></div>{signup && <p id={passwordHintId} className={styles.fieldHint}>At least 12 characters. Maximum 72 bytes.</p>}</div>
              {error && <div ref={errorRef} id={errorId} className={styles.error} role="alert" tabIndex={-1}><CircleAlert size={15} aria-hidden="true" /><div>{error}{created && <Link href="/login">Go to sign in<ArrowRight size={13} aria-hidden="true" /></Link>}</div></div>}
              <button type="submit" disabled={busy !== null} className={styles.submitBtn}>{busy === "credentials" ? <><span className={styles.spinner} aria-hidden="true" />{signup && !created ? "Creating account…" : "Signing in…"}</> : <>{signup && !created ? "Create account" : "Sign in"}<ArrowRight size={15} aria-hidden="true" /></>}</button>
            </form>
            {signup && <p className={styles.formNote}>Connecting WhatsApp is a separate, optional step. Review the unofficial-provider risks before pairing a number.</p>}
          </section>
          <p className={styles.footer}>{signup ? "Already have an account?" : "New to Pipelixr?"}<Link href={signup ? "/login" : "/signup"}>{signup ? "Sign in" : "Create an account"}</Link></p>
        </div>
      </main>
      <footer className={styles.pageFooter}><span>Pipelixr</span><span>Your work, with a little less friction.</span></footer>
    </div>
  );
}
