import LegalDocument from "@/components/LegalDocument";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata("/legal/acceptable-use");

export default function AcceptableUsePage() {
  return <LegalDocument title="Acceptable Use Policy" summary="Use Pipelixr lawfully, transparently, and in a way that respects recipients, connected providers, and the security of the service." sections={[
    { title: "You must", bullets: ["Connect only accounts, numbers, groups, and data you are authorized to manage.", "Use a lawful basis and required notices for personal-data processing.", "Keep reliable evidence of marketing consent and honor opt-outs immediately.", "Review material AI-generated commitments, prices, payment details, health or legal claims, and other high-impact content.", "Comply with messaging-provider rules, consumer-protection law, advertising standards, and applicable data-protection law."] },
    { title: "You must not", bullets: ["Send spam, purchased-list campaigns, deceptive promotions, or messages after opt-out.", "Impersonate others, misrepresent affiliation, or conceal the commercial nature of a message.", "Use the service for unlawful goods, fraud, harassment, hate, exploitation, malware, surveillance, or rights infringement.", "Upload unnecessary special-category data, authentication secrets, card data, or illegal content.", "Probe, disrupt, bypass limits, scrape, reverse engineer, or share access in a way that undermines security or providers."] },
    { title: "Enforcement", paragraphs: ["We may investigate, rate-limit, disable automation, suspend, preserve evidence, or terminate access where needed to prevent harm or comply with law. We may contact you for evidence of authorization or consent. Serious or urgent abuse may be acted on without advance notice."] },
    { title: "Reporting", paragraphs: ["Report suspected abuse or security issues to the support contact below. Include enough detail to investigate without sending additional sensitive information unnecessarily."] },
  ]} />;
}
