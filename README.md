# PIPELIXR

Revenue recovery for solo WhatsApp sellers in Nigeria. This repository is an existing prototype, not a production-readiness claim.

## Discovery and implementation approval

Start with the [Phase 0 discovery packet](planning/phase-0-discovery.md), [source audit](planning/repository-audit.md), accepted [architecture](planning/adr/0001-stack-and-queues.md), [send-safety](planning/adr/0002-send-safety-and-evidence.md), [Phase 1 foundation handoff](planning/phase-1-foundation.md), [Phase 2 read-only handoff](planning/phase-2-read-only.md), [Phase 3 suggest-first handoff](planning/phase-3-suggest-first.md), [Phase 4 seller actions](planning/phase-4-seller-actions.md), [Phase 5 measurement](planning/phase-5-measurement.md), and [Phase 6 extensions and hardening](planning/phase-6-extensions-and-hardening.md).

The production billing subsystem is documented in the [billing production runbook](planning/billing-production-runbook.md). Activation remains gated on live Paystack credentials, a reviewed data migration, and an explicit production deployment approval.

Phases 4 through 6 add a ranked seller action queue, seller-recorded orders and outcomes, payment reminders, stalled-inquiry actions, conservative revenue measurement, a manual Status viewer list, and connection-risk readiness. Existing broad legacy modules remain fail-closed. No read marking, reactions, presence, customer messaging, automatic outreach, provider-confirmed sends, or independently confirmed recovered revenue is enabled.

Onboarding and **Settings → Connection** offer **Meta Cloud API** (recommended for eligible WhatsApp Business app numbers) and **Evolution Go** (unofficial QR or pairing-code setup). Options are enabled independently on the Convex deployment. Pipelixr does not automatically migrate or replace a provider that still has a connection or an in-progress setup.

- **Meta Cloud API:** Complete the [Meta Cloud API Coexistence runbook](planning/meta-whatsapp-runbook.md), then enable signup with `META_WHATSAPP_ENABLED=true`. Outbound messaging has a separate gate.
- **Evolution Go:** Configure the provider and webhook URL, then enable `FOUNDATION_PROVIDER_ENABLED` and `FOUNDATION_PROVIDER_CONTRACT_VERIFIED` after qualifying the deployed build using the [Phase 1 runbook](planning/phase-1-runbook.md).

Deploy the Convex functions before releasing the matching frontend. Test each option with a separate pilot workspace and number. To switch an existing Evolution Go workspace, revoke it and reset it after the remote instance is removed. To switch an existing Meta workspace, disconnect the official link in the WhatsApp Business app and wait for Meta’s offboarding webhook to release the binding.

The local development instructions below are retained from the Next.js scaffold. Connecting a provider or deploying remains a separately gated non-production operation; follow the Phase 1 runbook.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

### Search and link previews

The canonical origin defaults to `https://www.pipelixr.com`. If the production domain changes, set `NEXT_PUBLIC_SITE_URL` to the new HTTPS origin before building so canonical URLs, social cards, and the sitemap all agree. Public metadata and the sitemap page list live in `src/lib/seo.ts`. Auth and workspace pages use `noindex` and are not in the sitemap.

After deploying, submit `/sitemap.xml` for the canonical domain in Google Search Console. Social apps and browsers may cache old previews and icons.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
