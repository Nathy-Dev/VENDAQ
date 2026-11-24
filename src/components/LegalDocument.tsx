import Link from "next/link";
import Brand from "./Brand";
import styles from "./LegalDocument.module.css";

export type LegalSection = { title: string; paragraphs?: string[]; bullets?: string[] };

const legalLinks = [
  ["/legal/terms", "Terms"], ["/legal/privacy", "Privacy"], ["/legal/dpa", "DPA"],
  ["/legal/acceptable-use", "Acceptable use"], ["/legal/billing", "Billing"],
  ["/legal/ai", "AI notice"], ["/legal/subprocessors", "Subprocessors"],
] as const;

export const legalOperator = {
  name: process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME?.trim() || "Pipelixr operator (legal name not configured)",
  address: process.env.NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS?.trim() || "Registered address not configured",
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim() || "Privacy contact not configured",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "Support contact not configured",
};

const configurationMissing = !process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME?.trim()
  || !process.env.NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS?.trim()
  || !process.env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim()
  || !process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();

export default function LegalDocument({ title, summary, sections, updated = "23 November 2026" }: { title: string; summary: string; sections: LegalSection[]; updated?: string }) {
  return <div className={styles.page}>
    <header className={styles.header}><Link href="/" aria-label="Pipelixr home"><Brand /></Link><Link className={styles.back} href="/">Back to Pipelixr</Link></header>
    <main className={styles.main}>
      <span className={styles.eyebrow}>Legal &amp; trust</span><h1>{title}</h1><p className={styles.updated}>Effective and last updated: {updated}</p>
      {configurationMissing && <div className={styles.notice} role="alert"><strong>Launch configuration required.</strong> The operator&apos;s registered legal name, address, privacy email, and support email must be set in the public legal environment variables before this service is offered to customers.</div>}
      <p className={styles.intro}>{summary}</p>
      {sections.map((section) => <section className={styles.section} key={section.title}><h2>{section.title}</h2>{section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}</section>)}
      <div className={styles.contact}><strong>Operator:</strong> {legalOperator.name}<br /><strong>Registered address:</strong> {legalOperator.address}<br /><strong>Privacy:</strong> {legalOperator.privacyEmail}<br /><strong>Support:</strong> {legalOperator.supportEmail}</div>
      <nav className={styles.nav} aria-label="Legal documents">{legalLinks.map(([href, label]) => <Link href={href} key={href}>{label}</Link>)}</nav>
    </main>
  </div>;
}
