# PIPELIXR repository audit

Date: 2026-10-27. Baseline: `ecc5d88` (`fix: evolution go request shapes`).
Scope: local tracked source, configuration, documentation, and static checks only.
No deployment, database, WhatsApp session, customer data, or secret values were inspected.
Findings describe reachable source behavior, not proof that it is deployed or exploited.

## Existing stack and conventions

| Area | Evidence and assessment |
| --- | --- |
| Web | Next.js 16.1.7 App Router, React 19.2.3, TypeScript 5.9.3 installed; `package.json:1`. Existing dashboard, pipeline, revenue, status, onboarding, profile, and settings surfaces. Retain, do not rebuild. |
| Backend | Convex 1.33.1 installed; schema, generated API types, object-form queries/mutations/actions, validators, indexes, scheduler and crons. No BullMQ/Redis dependency or worker implementation found. |
| Auth | Auth.js/NextAuth 5.0.0-beta.30, Google and credentials, bcrypt, JWT sessions (`auth.ts:11`, `convex/auth.ts:10`). Browser uses plain `ConvexProvider`, not an authenticated Convex bridge (`src/components/ConvexClientProvider.tsx:7`). No `auth.config.ts` or `ctx.auth.getUserIdentity()` usage found. Web login does not authorize Convex access. |
| WhatsApp | Evolution Go REST client and HTTP webhook; `IWhatsAppAdapter` exists (`convex/adapters/types.ts:50`) but callers also import the client directly. The `official` factory branch throws (`convex/adapters/whatsappAdapter.ts:35`); do not advertise a working official connection. A source comment names a Hostinger VPS; deployment topology is unverified. |
| AI/media | Groq text generation, OpenAI vision, Cloudinary media plus Convex storage. Model IDs are environment-driven in `convex/README.md:1`; retain that convention, not the premature auto-reply behavior. |
| Style | CSS Modules plus global/Tailwind styles, relative backend imports and `@/*` frontend alias. `strict: true` but `noImplicitAny: false`; ESLint allows explicit `any` (`tsconfig.json:9`, `eslint.config.mjs:17`). Object validators are common; return validators are inconsistent. |
| Operations | Ad hoc console logging and Convex scheduling. No tracked CI, migration history, durable send ledger, queue retry/DLQ policy, or executable automated test suite found. `.env.local` is ignored and was not opened. `.gitignore` ignores `/docs`, so review documents live in tracked `planning/` without weakening existing ignore rules. |
| Documentation | Root README is create-next-app boilerplate. `convex/README.md` contains actual model configuration followed by boilerplate. No tracked PRD or ADR found. Code comments mentioning a PRD are legacy requirements evidence, not an authoritative PRD. An Evolution status document is explicitly ignored but absent locally. |

## Current data and function map

`convex/schema.ts:6` defines 20 tables. Business ownership is an unverified string, not an enforced authorization boundary.

- `businesses` owns customers, orders, inventory, interactions, statuses/views, automations, templates, follow-up tasks, runs, outcomes, AI logs, managed groups, daily snapshots and disconnection alerts.
- Customers link to interactions, orders, tasks and outcomes through `customerId`; interactions serve as the conversation store. There is no separate conversation/opportunity aggregate.
- Status views link optionally to a status, otherwise only its provider ID. Automations reference templates; runs reference templates and optionally automations. Outcomes lack an order/payment foreign key.
- `users` links to accounts and sessions; verification tokens are separate. Auth.js uses JWT sessions; schema presence does not prove accounts/sessions tables are populated.
- Useful tenant indexes exist, notably customers by business/phone and business/stage. Interaction/status provider-ID indexes and the status-view status index are global. No dedicated inbox/outbox or event-history table exists.

| Module / surface | Public versus internal behavior |
| --- | --- |
| `businesses.ts` | Public queries fetch by supplied owner/business/instance and mutations update business/configuration/connection data. Instance lookup scans businesses and accepts display-name matches. |
| `auth.ts`, `users.ts` | Public signup/credential-check actions call internal user insert/lookup. These are legitimate unauthenticated auth entry points, but require abuse controls; they do not establish Convex tenant authorization. |
| `interactions.ts`, `orders.ts` | Public conversation/customer reads, name/cleanup mutations, order creation/status updates. Some comparisons of two supplied IDs exist; caller ownership is not established. |
| `whatsapp.ts` | Public session actions, ingestion/history/status mutations, customer/template/task queries, send/automation/actions, outcome and metric APIs. `deleteStatus` is internal. Worker-like operations are otherwise largely client-callable. |
| `ai.ts`, `groups.ts`, `safeguards.ts` | Public model/media actions and AI updates/queries; group refresh/enablement; alert reads/writes. These are not protected merely because the UI hides them. |
| `pipeline.ts`, `crons.ts` | Public priority/metric reads and `processAskedNoOrderFollowUp`; internal scans, snapshots, maintenance and cron runners. Several runners schedule public actions. Four active cron definitions cover maintenance, stalled leads, payments and automation. |
| HTTP edges | Convex `POST /api/webhook/evolution` and Next.js `POST /api/worker` ingest supplied events. Neither inspected entry establishes authenticated sender identity. The Next.js auth route exposes Auth.js handlers separately. |
| Diagnostics | `convex/temp_test.ts:3` is a public query returning every business. `convex/test.ts:4` is a public live-provider provisioning probe, not a unit/integration test. Neither was invoked. |

Representative current flows:

1. Evolution webhook -> resolve business from payload/header/name -> `receiveMessage` -> keyword classification -> customer/interaction writes -> scheduler -> AI and automatic follow-up. Noise can return before storage/cancellation. Provider side effects also occur from media/read-receipt handling outside this mutation.
2. Status receipt -> `syncStatusView` -> viewer customer -> delayed `viewed_no_dm` task -> generated message -> `sendRetargetMessage` -> REST `/send/text` -> log interaction afterward. A lost acknowledgement has no durable reconciliation ledger.
3. Revenue UI -> public metrics query -> sum won action outcomes, falling back to estimated value. No qualifying overdue-conversation/order/payment evidence chain is required.

## Findings and brief reconciliation

Severity is for launch suitability, not a claim of a live incident. The attached brief supersedes conflicting code comments and marketing copy.

| ID / severity | Evidence | Conflict and recommended disposition after approval |
| --- | --- | --- |
| A01 Critical | `convex/businesses.ts:4`, `convex/temp_test.ts:3`, `convex/orders.ts:34`, `src/components/ConvexClientProvider.tsx:7` | Strict tenant isolation is absent. Supplied IDs can read/write another tenant; order creation does not validate customer ownership. Derive identity server-side, validate all parent/child ownership, restrict worker APIs, and remove public diagnostics before real onboarding. |
| A02 Critical | `convex/http.ts:19`, `convex/businesses.ts:19`, `src/app/api/worker/route.ts:6` | Webhook headers/tokens are treated as routing hints, not verified credentials; display names can select tenants. Authenticate before parsing business effects; bind a verified instance/session to exactly one tenant; retire or secure the legacy proxy. |
| A03 Critical | `convex/whatsapp.ts:807`, `convex/whatsapp.ts:1410`, `convex/whatsapp.ts:1583`, `convex/crons.ts:36` | Viewer auto-follow-ups and segment-loop campaigns conflict with deferred Status outreach and no cold bulk sends. Remove from the approved path and invalidate legacy pending work during an approved migration. A Status view is not inbound-DM consent. |
| A04 Critical | `convex/whatsapp.ts:1272`, `convex/pipeline.ts:467`, `convex/whatsapp.ts:1626` | Follow-ups send without per-task seller approval; low-level send is public and bypasses the shared guard query. Separate AI enablement from send permission; fail-closed phase/mode gate and one authoritative outbound path. |
| A05 High | `convex/whatsapp.ts:275`, `convex/whatsapp.ts:333` | Legacy comment says discard noise; brief says capture every inbound DM. Store all eligible DMs, classify separately, and distinguish a captured profile from a sales-qualified lead. Casual replies must still cancel stale tasks. |
| A06 High | `convex/whatsapp.ts:366`, `convex/whatsapp.ts:407`, `convex/whatsapp.ts:1272` | Cancellation varies by reason: owner replies cancel buying/viewer tasks; customer replies cancel viewer tasks, not all pending work. Buying-signal execution checks only owner replies. Introduce conversation revisions and atomic cancellation/revalidation for every reason. |
| A07 High | `convex/whatsapp.ts:1842`, `convex/evolutionGoClient.ts:517` | Send guard hardcodes local-runtime hours 07-22, rolling caps 3/contact and 250/business; persisted automation settings are not consulted there. Jitter is a per-call sleep, not a serialized rate limiter. Business timezone, quiet/work hours, cooldown, atomic quotas, warm-up, kill switch and failure tripwire must govern every send. |
| A08 High | `convex/whatsapp.ts:240`, `convex/whatsapp.ts:656`, `convex/whatsapp.ts:738`, `convex/evolutionGoClient.ts:517` | Incoming dedup is partial and global by provider ID, with content/time fallback; status IDs cross tenant boundaries. Send returns void and logs after the network call. Add tenant/session-scoped inbox, outbox and send intent keys; unknown network outcomes must never be blindly retried. |
| A09 High | `convex/whatsapp.ts:14`, `convex/ai.ts:492`, `convex/ai.ts:197` | Three inline keyword classes lack payment-related and a replaceable classifier interface. Smart follow-up uses the generic prompt, not the owner-aware guardrails, and accepts output by length. Missing-model lookup occurs outside its fallback try/catch. Use a typed classifier contract and validated grounded suggestions/templates. |
| A10 High | `convex/whatsapp.ts:455`, `convex/groups.ts:127`, `convex/http.ts:533`, `convex/ai.ts:1097` | Per-group opt-in is present in one classification path, which is useful groundwork. Public enablement is unauthenticated; keyword task creation precedes group gating; media AI and public actions need their own gate. Default-off is not an end-to-end invariant yet. |
| A11 High | `convex/whatsapp.ts:2083`, `convex/whatsapp.ts:2126`, `convex/pipeline.ts:228`, `convex/schema.ts:244` | Won outcomes can use estimates as recovered revenue; no N-day eligibility, overdue snapshot, linked order or confirmed payment evidence. Introduce a versioned attribution ledger. Preserve legacy numbers as unverified, never automatically confirmed. |
| A12 High | `convex/schema.ts:12`, `convex/http.ts:70`, `convex/http.ts:354`, `convex/ai.ts:1097`, `convex/evolutionGoClient.ts:241` | Arbitrary connection details, raw payload samples, media forwarding and tokens falling back to instance names are unsafe foundations. No complete retention/deletion policy or app-level credential-encryption workflow found. Host encryption/backup controls are unknown, not proven absent. Minimize/redact data and establish encrypted session storage, rotation and deletion before real traffic. |
| A13 Important | `convex/orders.ts:66`, `convex/whatsapp.ts:795`, `convex/pipeline.ts:561` | Stage assignment is scattered: views can reset stages, order states map directly, inactivity auto-marks lost. Centralize legal transitions; do not interpret silence, delivery, or an image of payment proof as confirmed payment. |
| A14 Important | `convex/whatsapp.ts:2521`, `convex/whatsapp.ts:2176`, `src/components/LandingPage.tsx:211` | Owner command replies are not a scheduled digest with verified actions. Cancelled tasks are counted as replies in one metric; marketing claims 3x recovery without evidence here. Implement event-derived metrics/digest later; remove unsupported claims before publication. |

## Invariant coverage today

There is **no automated evidence for any of the eight invariants**. These are source findings, not passing tests.

| Invariant | Present source behavior | Required regression coverage |
| --- | --- | --- |
| I1 No bulk cold outreach | Violated by viewer tasks/segment sends | Imported/view-only/unknown contacts, groups and bulk recipient requests never dispatch; one approved warm task can dispatch in an enabled phase. |
| I2 Customer cooldown | Partial viewer-specific gates | Cross-reason, repeated-click and parallel-worker attempts share one atomic cooldown. |
| I3 Reply cancellation | Partial, reason-specific | Customer or seller reply, including casual/non-text replies, cancels all older pending tasks; replay/out-of-order and approval/send races included. |
| I4 Hours/caps | Hardcoded partial gate | Tenant-local boundaries, overnight windows, quiet-hours precedence, cap reservation races and deferred-job rechecks. |
| I5 Group AI opt-in | Partial classification-path gate | Missing/false config, direct action, media and revoked-opt-in jobs cannot call AI; authenticated explicit opt-in is the only positive case. |
| I6 Grounded guardrails | Prompts/length checks insufficient | Untrusted message injection, unsupported facts, forbidden details, malformed output, AI-off/error/config failure and template validation. |
| I7 Tenant isolation | Absent caller authorization | Anonymous and tenant-B reads/writes/listings/media/digest tokens/worker events against tenant A all fail; mixed parent-child IDs fail. |
| I8 Event/send idempotency | Partial ingest, no durable sends | Concurrent duplicates, tenant-colliding IDs, repeated approvals, worker crash windows, redelivery after Redis loss and ambiguous provider acknowledgements. |

The implementation-phase test allocation and approval gates are in [Phase 0 discovery](phase-0-discovery.md).

## Local validation baseline

- `node_modules/.bin/tsc.cmd --noEmit --incremental false --pretty false`: **passed**.
- `node_modules/.bin/eslint.cmd . --format json`: **failed**, 1 error and 33 warnings. Existing error: `src/components/DashboardNavbar.tsx:89`, `react-hooks/set-state-in-effect`. No unrelated fixes made.
- No test script/framework/CI suite is present. Live diagnostic actions are not tests and were not run. No build, deployment, model API call or provider probe was performed.
- Git working tree was clean before discovery. No runtime source, dependency, schema, environment or deployment settings were changed by this audit.
