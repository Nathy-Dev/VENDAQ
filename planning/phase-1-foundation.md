# Phase 1: foundation

Status: **implemented locally on 2026-10-28; not deployed**.

## Seller outcome and metric

A seller can create an isolated workspace, accept the unofficial-WhatsApp risk disclosure, connect an Evolution Go instance, and inspect newly captured direct conversations without PIPELIXR sending or classifying anything. Success is measured by authenticated webhook acceptance, duplicate collapse, conversation visibility, visible connection/dead-letter state and completed privacy deletion—not leads, conversion or recovered revenue.

## Shipped scope

- Canonical Auth.js identities signed into Convex with short-lived RS256 JWTs and a public-only JWKS route.
- Identity-derived business ownership on every active seller read/write; cross-tenant linked IDs fail as not found.
- Encrypted WhatsApp tokens and QR artifacts with AES-GCM context binding, versioned keys and tenant-scoped HMAC identity digests.
- Consent-gated Evolution Go create/connect/status/QR/disconnect actions behind two provider qualification flags.
- Exact `instanceId` plus token-hash webhook authentication; no routing by display name.
- Durable normalized inbox with tenant/session/generation deduplication, atomic scheduling, leases, backoff, replay and terminal dead letters.
- Direct and owner-message capture, opaque LID preservation, non-text/manual-review metadata, receipt evidence and minimal Status observations.
- Automatic cancellation of pending legacy follow-up tasks on either party's reply, including scheduled-function cancellation where an ID exists.
- Immediate privacy suppression plus bounded batched deletion of messages, tasks, queued payloads, receipts and observations; visible deletion dead letters/retries.
- Configurable retention and one-minute cleanup/reconciliation.
- Additive Phase 1 workspace over protected signed-in routes. Existing later-phase components and provider/worker implementations remain preserved but inactive and fail closed.
- Credentials normalization, bcrypt byte bounds, anti-enumeration work and transactional account/global rate limits.

## Acceptance evidence

The `convex-test`/Vitest harness uses synthetic tenants, identities, messages, media metadata, receipts, timers and provider responses. It never calls the configured Convex or Evolution deployment.

- 100 concurrent duplicate webhook deliveries produce one inbox event, one customer and one message.
- The same provider message ID is independent across tenants; anonymous, wrong issuer and mixed-resource access fail.
- Casual text, audio, image and owner replies are stored and cancel pending tasks; clocks remain monotonic under out-of-order delivery.
- Groups do not create customers, Status views do not create leads/tasks, and LIDs are not converted to phone identities.
- Invalid authentication fails before persistence; authenticated malformed events become minimized dead letters without raw content.
- Retry/backoff, lease recovery, stale attempts, replay, deletion DLQ, retention, migration checkpoints and disconnect recovery are deterministic.
- Credentials and QR values are encrypted; tamper, context crossing and key rotation are tested.
- All registered legacy functions throw `PHASE_DISABLED`; non-allowlisted provider operations throw `OUTBOUND_DISABLED`.
- Current result: 38 tests pass; root and Convex TypeScript checks pass; focused lint and production build pass; full lint has no errors and 33 preserved legacy warnings; `npm audit` reports zero vulnerabilities.
- Security maintenance included compatible upgrades to Next.js 16.4.3, Auth.js beta.32 and Convex 1.48.0. The prior React Hooks lint plugin is pinned so unrelated preserved UI is not silently refactored by a transitive lint-rule change.

## Explicitly cut or deferred

- No classification, keywords, AI, model/media vendor calls or labeling tool. Phase 2 owns these.
- No suggestions, customer sends, seller digest, read marking, reactions, presence, media download, bulk action, Status outreach or automation.
- No positive claim yet for cooldowns, work/quiet hours, caps, group-AI opt-in or AI guardrails. Those send-time invariants gate Phase 3; Phase 1 proves sending is disabled.
- No recovery/revenue metrics, order attribution or inferred phone number from a LID.
- No deployed provider qualification, schema migration or deployment.

## Known limitations

- Public Evolution Go docs/OpenAPI were reviewed, but the deployed build number and redacted Swagger/auth fixtures were not captured. Keep provider qualification false until the runbook is completed.
- Auth bridge variables must exist in both web and Convex configuration. Missing configuration intentionally leaves the signed-in workspace unavailable.
- Legacy business owners are not silently relinked. `foundationVersion=0` records require an operator-reviewed subject mapping.
- Revoked sessions fail closed and require an operator reset before reconnect.
- Fake-source tests prove application behavior, not hosted Convex crash recovery or the deployed Evolution Go contract.

## Recommendation

Qualify and deploy Phase 1 to a named non-production target, run the dry-run migration and fake webhook smoke test, then review the connection/dead-letter/privacy screens. Do not begin Phase 2 until the owner approves this handoff.
