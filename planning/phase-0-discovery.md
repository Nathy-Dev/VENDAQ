# PIPELIXR Phase 0: discovery and approval packet

**Status: reviewed. Phase 1 started on 2026-10-27; see [Phase 1 foundation](phase-1-foundation.md).**
Date: 2026-10-27. Authority: the attached product brief; no tracked PRD was found.
Evidence: [repository audit](repository-audit.md). Decisions: [stack and queues](adr/0001-stack-and-queues.md), [send safety and evidence](adr/0002-send-safety-and-evidence.md).

Provider documentation supplied and reviewed: [Evolution Go contract review](evolution-go-contract-review.md). The documentation-source blocker is resolved; deployed-build qualification and the queue amendment remain separate from Phase 1 approval.

## Recommendation and scope

Keep Next.js, React, TypeScript, Auth.js, Convex and Evolution Go. The owner confirmed no deployment serves real sellers, no worker exists, and approved Phase 1 after the Convex-native scheduling amendment was discussed. ADR 0001 records that accepted decision. Repair this prototype in place; do not mistake existing later-phase code for completed phases.

The product is an overdue-buyer recovery workflow, not an autonomous sales chatbot. Success means a seller can identify a genuine missed opportunity, approve a safe follow-up, and trace the resulting reply/order/payment without guessing revenue.

**Do not onboard real sellers or enable sending on the audited source until foundation safety is repaired.** Public tenant APIs and webhook ingestion are unauthenticated, Status viewers can receive automatic outreach, and recovered revenue can include estimated values. The owner confirms there are no real sellers; this does not mean existing test data or connected numbers may be deleted or messaged without approval. No live kill switch, task cancellation or deployment change was made during discovery.

### PM/engineering conflicts requiring explicit resolution

| Conflict | Recommendation and displaced scope |
| --- | --- |
| Original BullMQ decision versus owner clarification that a worker is not needed | BullMQ requires a worker consumer, although not necessarily another server. Recommend Convex-native scheduled functions/crons instead, with durable retry/dead-letter records and unchanged send safety. This displaces Redis, the relay and separately managed queue-worker operations. The ADR amendment requires explicit approval before replacing the original decision. |
| Existing generic auto-reply, vision and campaigns versus suggest-first recovery | Remove them from the approved execution path, preserve relevant UI/domain assets, and deliver read-only evidence first. This displaces chatbot polish, campaign controls and automatic media analysis. |
| Phase 6 says hardening/ban monitoring, but safety invariants apply to earlier sends | Implement identity, privacy and no-send gates in Phase 1; minimum cooldown/caps/throttling/kill switch/failure monitoring before Phase 3 sends. Phase 6 adds scale/load qualification, not basic safety. This displaces early UI polish, not the invariants. |
| All sends must be idempotent, but Evolution Go request-ID/acknowledgement semantics are unverified | Require a durable send ledger, no repeat submission after an unknown outcome, and a provider contract test before enabling dispatch. This sacrifices automatic recovery of ambiguous sends rather than risking duplicates; it does not claim cross-system exactly-once delivery. See ADR 0002. |
| Each inbound DM must be captured, while legacy code discards noise | Persist every eligible DM, including noise, within retention limits; count qualified leads separately. More retained text means retention/deletion is a foundation requirement. |
| Phase 1 mentions classification while Phase 2 introduces it | Phase 1 stores normalized messages and review flags; Phase 2 activates the versioned keyword classifier. No AI is needed to prove ingestion. |
| Status is in the core-loop description, but viewer surfaces are deferred to Phase 6 | Record only validated view observations when available, without tasks, outreach, guessed phone numbers or a new viewer UI. Unknown shapes remain quarantined; missing views are not zero interest. |
| One-tap WhatsApp actions versus unknown interactive/self-chat support | Prefer verified native action callbacks. Otherwise propose an authenticated web action page, which may require a second tap. Never send from a GET link: previews/prefetches could trigger it. Owner must approve this fallback if native actions are unsupported. |
| Every phase asks for implementation/tests, but Phase 0 forbids feature code | This phase delivers reviewed artifacts and local baseline checks only. Tests below are acceptance specifications, not tests already implemented or passing. |

## Original BullMQ architecture (superseded history)

No worker is currently deployed. This section preserves the original brief-compatible design for comparison. If the ADR 0001 amendment is approved, replace the relay/Redis/worker path with atomic Convex mutation scheduling and internal scheduled functions/crons; retain inbox deduplication, durable task/send records, authorization, bounded retries, dead-letter handling and the single send gateway. Do not build both execution paths.

```text
Seller -> Next.js + Auth.js -> short-lived verified Convex identity
                               -> tenant-authorized queries/mutations
Evolution Go -> authenticated webhook -> durable Convex inbox
             -> normalize + persist -> domain updates + transactional outbox
Outbox relay -> BullMQ / durable Redis -> persistent TypeScript workers
             -> authenticated narrow Convex worker endpoints
             -> classification / due-task evaluation / suggestions / digest
Seller approval -> atomic send intent -> single dispatch gateway -> Evolution Go
Provider echo/receipt -> inbox -> send reconciliation -> order/payment evidence
```

- Convex remains the source of truth; Redis carries IDs, not conversations or credentials. A Convex mutation commits domain state and its outbox record together. The relay leases work and enqueues deterministically; consumers check durable completion before repeating effects.
- A persistent Node worker runs outside Next.js request handlers and Convex functions. No second independently scheduling Convex cron system after cutover. A BullMQ maintenance job reconciles overdue/unpublished outbox work after downtime.
- Retain Auth.js login UX, establish a verified short-lived signed-token bridge with issuer/audience/expiry and stable subject, and configure Convex to validate it. Never trust a browser-supplied owner ID. Do not merge Google and password accounts solely by an unverified matching email. Confirm version-specific auth APIs before implementation.
- Each public endpoint validates identity and tenant membership, including linked parent/child resources, storage URLs and aggregate queries. Workers authenticate with rotated scoped credentials to narrow endpoints invoking internal functions; possession of a business ID is never authority. Webhooks route through a server-maintained verified instance mapping, never a display name.
- Preserve/complete the provider adapter, adding normalized event and send-result contracts. A separate classifier interface accepts normalized text, locale hints and classifier version; returns the four classes, matched evidence/reason, optional calibrated confidence, and manual-review flag. Callers never depend on keyword/LLM internals.
- No model calls for Phase 1/2 media. Voice notes, product/payment screenshots and unsupported formats are stored as metadata/review-required; no fabricated transcript, stock or payment decision. Do not forward personal data to an AI/media vendor just because a webhook contains a URL.
- Structured logs carry `correlationId`, opaque `businessId`, `eventId`, `jobId`, `taskId`, `sendIntentId`, attempt and reason code across boundaries. No raw message, phone, token, QR or media URL in logs. Metrics cover ingest lag, duplicate drops, pending outbox age, queue lag, retries/DLQ, suppression reasons, unknown sends, disconnects and delivery failures. Alerts cannot depend solely on the disconnected WhatsApp channel.

## Proposed data model

Names describe logical records, not a schema migration authorized now. Every tenant-owned record carries `businessId`; every relationship must verify matching ownership. Compound indexes begin with tenant/session where appropriate. Convex uniqueness must be enforced by indexed transactional lookups, not assumed from index declarations.

| Record | Essential fields, keys and relationships |
| --- | --- |
| Business / membership / settings | Stable authenticated owner subject, role, timezone, response window, work/quiet hours, cooldown, caps, warm-up policy, send mode, kill switch, feature flags, retention and policy version. Solo owner first; no team UI. |
| WhatsApp session | Business, immutable provider instance ID, session generation, state/last health, encrypted credential reference/key version, disconnect reason. No secrets or QR artifacts in general business queries. |
| Customer / identity alias | Business, opaque provider JID/LID, optional verified phone/name, source, first inbound proof, opt-out/deletion flags. Key `(business, provider, remoteIdentity)`; merge aliases only with provider evidence. Groups and seller-self addresses are not customer sales leads. |
| Conversation / opportunity | Customer, inbound-initiated evidence, last customer/seller event, monotonic revision, overdue anchor/window, journey stage/version, open/lost reason. Separate opportunity episodes prevent a repeat purchase from reopening an old paid order. |
| Message / classification | Conversation, direction/actor, media type/review flag, optional content, provider ID, event time and received time, normalized event key, classifier version/class/evidence. Evolve `interactions` rather than blindly copy it. |
| Inbox / outbox / job receipt | Verified source, scoped dedup key, correlation, bounded encrypted payload reference/expiry, processing state; outbox kind/dueAt/payload IDs/lease and durable completion. Message-create and receipt/update events have distinct semantic keys. |
| Follow-up task / suggestion | Conversation/opportunity, reason, trigger message/order, dueAt, createdAt, captured revision, policy version, status/cancel reason, template/fact versions, draft and approval actor/time. Unique logical key per opportunity/reason/trigger, not one per webhook. |
| Send intent / attempt / quota | Stable idempotency key `(business, task, approvedVersion)`, recipient, purpose, payload hash, reservation/fencing token, state, provider message ID, submitted/accepted/delivered/failed times, error/unknown reason. Atomic per-customer cooldown and business-local-day counters. Seller digest uses a separate purpose, never a sales outcome. |
| Order / payment / attribution | Business + customer + opportunity, line items, currency, integer minor-unit totals; won/lost actor/time; claimed and independently confirmed payment amounts/evidence; refund/reversal records; qualifying send and attribution-policy version. Existing `orders` and `actionOutcomes` require evidence-preserving migration. |
| Audit / daily metrics / deletion job | Append-only domain transitions and evidence references; derived versioned metrics; retention/deletion checkpoints, scope and backup expiry. Audits minimize personal content, not retain all chat text indefinitely. |
| Status observation / group policy | Provider status ID plus opaque viewer identity/time/source and verification confidence; no outreach eligibility. Group AI is default-off, explicit authenticated enablement/revocation is audited. Viewer UI stays Phase 6. |

Money assumption: NGN, integer kobo internally; unknown estimated value stays unknown, never a default revenue amount. Ranking may show a separately labelled seller-configured average-order estimate. No currency conversion or payment integration is added without a later scope decision.

## State and scheduling rules

| From | Legal event -> destination |
| --- | --- |
| Viewer | Verified customer DM -> Engaged. View alone never creates Intent or send eligibility. |
| Engaged | High-precision buying signal or seller qualification -> Intent; seller-created real order -> Order created; explicit loss/opt-out -> Lost. Casual/noise remains Engaged. |
| Intent | Seller-created order -> Order created; explicit loss/opt-out -> Lost. An inquiry does not downgrade it. |
| Order created | Payment requested -> Awaiting payment; confirmed payment -> Paid; cancelled/lost order -> Lost. |
| Awaiting payment | Confirmed payment -> Paid; explicit cancellation/expiry adjudication -> Lost. Screenshot alone leaves it pending/manual review. |
| Paid / Lost | Terminal for this opportunity. New customer interest creates a new Engaged opportunity; corrections/refunds append audit events rather than silently rewriting history. |

Classification is message-level; journey stage is opportunity-level; `won` is a seller outcome and does not prove payment. Payment-related messages can occur at any stage and need not create a new order. Any unlisted transition is rejected with a reason and no writes. Stalled/overdue are derived flags, not automatic Lost states.

- Use elapsed wall-clock response windows initially. Quiet/work hours govern dispatch, not whether unanswered intent appears in the report. Record the trigger and window version; do not change historic eligibility when settings change.
- After the response window, create one task only if that trigger remains unanswered. A later customer or seller reply cancels **all** older pending follow-ups, including payment reminders; a still-valid reminder requires a new evaluation/task. Store casual and media replies too. Duplicate echoes must not manufacture another reply or task.
- Recheck revision, opt-out, deletion, connection, phase/mode, approval version, group/inbound eligibility, hours, kill switch, cooldown and quotas at execution. Reserve atomically; serialize per business across workers. Jitter occurs before the final recheck, not after it. Work deferred by hours/caps is rescheduled with fresh checks, not marked sent.
- Verified new inbox activity fences dispatch for that conversation until normalization/cancellation completes; do not wait for AI/classification to recognize a reply. Track an ingestion watermark so queue lag cannot masquerade as customer silence. The gateway's atomic final authorization is the ordering boundary; a reply received after irreversible submission cannot recall the message.
- Replies during approval/queue wait cancel the task. Replies arriving after irreversible network submission cannot unsend a message; retain both timestamps and flag the race. Uncertain ordering, reconnect replay gaps or unresolved session state blocks sends rather than assuming silence.
- Task lifecycle: pending evaluation -> suggested -> approved -> dispatching -> sent; pending/suggested/approved can become cancelled or expired. Send lifecycle separately records reserved/submitting/accepted/delivered/failed/unknown. A worker lease expiring after submission never authorizes a second submission.

## Original BullMQ topology and failure policy

Conditional on retaining BullMQ. Under the proposed Convex-native replacement, these names become logical task kinds rather than Redis queues; durable attempt/dead-letter records and reconciliation remain required. The worker-hosting question is superseded by the architecture approval question below.

| Queue | Job and dedup identity | Enabled phase |
| --- | --- | --- |
| `events` | Normalize/process a committed inbox event; `(tenant, session, semanticEventKey)`. Preserve provider time and reconcile out-of-order events; no timestamp rollback. | 1 |
| `classify` | `(message, classifierVersion)`; text only, media -> review. | 2 |
| `followup-evaluate` | Delayed/periodic eligibility checks keyed by trigger/reason/window version. Payment/stalled rules enter in Phase 4. | 3 |
| `suggest` | `(task, revision, guardrailVersion)`; validated AI or safe business template. | 3 |
| `dispatch` | Durable send-intent ID; exactly one gateway, atomic tenant/contact reservations. Manual approval required until opt-in Phase 6. | 3 |
| `seller-digest` | `(business, localDate, digestVersion)`; verified self-chat, preferences and same gateway safety rules. | 4 |
| `maintenance` | Health, outbox reconciliation, retention/deletion; later snapshots and attribution rebuilds. Keyed by operation and scheduled interval/version. | 1, extended 5 |

Every queue has bounded timeouts, exponential backoff with jitter and a `<queue>-dlq` terminal path. Proposed configurable default: 5 attempts, 2-second base, 5-minute ceiling; authentication/schema/policy failures fail or quarantine immediately. AI failure uses a template without delaying eligibility indefinitely. Ambiguous outbound submission is **not retryable**: mark unknown and reconcile under ADR 0002. Definite pre-submission failures may retry the same intent.

Persist failures and completion in Convex so Redis restart/job retention cannot erase idempotency or dead-letter evidence. DLQ replay requires an authorized operator, unchanged logical identity and full policy rechecks; terminal DLQs alert rather than recursively retry themselves. Redis persistence/backups and a reconciliation sweep recover scheduling, never infer that a send did not happen. Queue payloads contain no chat content, phone numbers or session credentials.

## Safety, privacy and attribution

- Separate `aiEnabled`, group opt-in, global automation flag, business tier/opt-in, send mode and kill switch. Defaults: AI off in the pilot, group AI off, automation flag off, suggest-first; Phase 1/2 override all settings with no application-originated sends. No bulk send endpoint or Status-view outreach in any approved phase.
- Templates and AI drafts may only use approved business facts. Guardrail prohibition wins even over a known fact. If price/stock/discount/payment facts are missing, omit them and ask the seller. A prompt or regex alone cannot prove semantic safety: constrain fact-bearing text to validated slots, reject ungrounded output, and fall back to a validated template. Business free text and customer content are untrusted, not instructions.
- If unconstrained generated prose cannot be proven compliant, keep the outbound candidate template-only and let AI select approved phrasing/slots rather than invent sentences. Seller approval is not a substitute for enforcing business guardrails.
- NDPA design: disclose unofficial access, purpose, retention, vendor processing and deletion options before connection; determine lawful basis/controller/processor roles and cross-border obligations with qualified counsel before real pilot data. Store only necessary DMs/metadata, not the full address book/group history. Use least-privilege access, encrypted transport and envelope-encrypted credentials with rotated external keys, including Evolution session storage and backups. Protect short-lived QR/pairing material.
- Proposed pilot retention: raw webhook payload <=7 days, conversation text <=90 days, media download off by default, audit/financial metadata <=365 days pending legal review. These are design proposals, not NDPA-prescribed periods. Prefer shorter periods; separately document any required financial retention/holds. Deletion revokes queued work immediately, purges active stores/vendors within a proposed 7 days, and records backup expiry (proposed <=30 days). Restores must reapply deletion tombstones; replay dedup tombstones may retain only minimized keyed hashes for the provider retry horizon.
- Attribution: an order explicitly marked won within configured `N` days after a **known accepted** follow-up on a conversation already overdue at send-time is eligible. Proposed `N = 7`, versioned per business. Store trigger, window/deadline, no-reply evidence, accepted send ID/time, order link, won time and value source. Missing evidence means ineligible, not estimated revenue.
- Claimed recovered value is seller-declared and separately labelled. Confirmed recovered value additionally requires verifiable payment evidence (provider reconciliation or an auditable independent bank/receipt verification process). A seller assertion or screenshot alone stays claimed. One order is attributed once to its first qualifying follow-up within the window; multiple follow-ups never multiply it. Confirmed amount is capped at the actual net paid order amount, excluding refunds. Corrections append reversals; dashboard totals must reconstruct from the ledger. This is rule-based attribution, not proof of causal lift.

## Phase acceptance gates and seller metrics

Approval is required after **each** phase. Every implementation phase includes a focused spec, code, unit/integration/invariant results, migration and rollback notes, updated ADRs, and shipped/cut/next summary. Do not hide missing tests behind a dashboard demo.

| Phase | Testable acceptance statements | Seller outcome / metric |
| --- | --- | --- |
| 0 Discovery (now) | Audit maps source and contradictions; architecture/model/states/queues and five risks documented; <=5 blocking questions; no feature/deployment changes. | Owner can approve an evidence-backed, bounded foundation plan. |
| 1 Foundation | Authenticated tenant A cannot read/write B, including forged child IDs/storage/worker events. One fake DM replayed concurrently 100 times creates one customer/message and one logical job; the same provider ID in two tenants remains independent. Noise/media are captured; group AI stays off. Invalid webhook credentials have no effects. Disconnect/auth/queue failures are visible. No application-originated sends, read marks, reactions, typing or digests occur. Retention/deletion and encrypted-secret access are exercised with fake data; migration backfills resume safely. | Capture completeness and ingest lag; zero cross-tenant or duplicate logical writes in tests. |
| 2 Read-only evidence | Swappable keyword classifier outputs buying/inquiry/payment/casual classes with evidence; media is manual-review. Report shows actual unanswered buying-signal messages strictly past configured response window, tenant-scoped, excluding answered signals. Labeling export/evaluation reports precision, recall, confusion matrix and slices on held-out data. Fake provider records zero application send/read/reaction/presence calls even when legacy tasks replay. | Qualified missed leads, report usefulness, classification precision/recall, false-positive rate. |
| 3 Journey/follow-up | All legal/illegal transitions tested; one task per eligible trigger; reply cancels any older pending task; AI-off/down/misconfigured/unsafe output uses safe templates. Suggestion alone never sends. Approved warm task uses one gated dispatch, with concurrent cooldown/cap, hours, jitter, warm-up, kill-switch, stale approval and unknown-result tests. All I1-I8 must pass before any real send trial. | Seller approval rate, time to approved action, send/duplicate/stale-task failure rates. |
| 4 Seller surfaces | Queue ranks eligible tasks with transparent rules/reasons/estimated-or-unknown value. Payment/stalled tasks cancel on reply/order resolution. Digest goes only to verified seller self-chat; duplicated/expired/foreign actions cannot mutate/send. Sent/ordered/won/lost actions are idempotent; direct native actions or approved fallback are contract-tested. | Daily queue/digest action rate, median seller time per action, actual buyer replies after accepted sends. |
| 5 Measurement | Dashboard definitions match event fixtures and timezone boundaries; every recovered amount drills down to eligibility/order/payment evidence. Outside-window, unknown-send, duplicate-order, estimate-only, unverified payment and refund cases cannot inflate confirmed revenue. Rebuild equals ledger totals. | Leads captured, unique buyers replying, follow-ups accepted, open missed opportunities, orders, net confirmed payments, claimed versus confirmed recovered revenue. |
| 6 Flagged extensions | Manual Status list labels incomplete/unresolved identities and creates zero outbound tasks. Automation requires platform flag + business entitlement + explicit opt-in + warm inbound proof; revocation/kill switch wins immediately for unsubmitted work. Agreed load/soak tests and ban-risk tripwire/recovery drills pass; missing provider capabilities keep features off. | Incremental time saved, delivery failures/unknowns, number-health incidents, manual-viewer usefulness; no unsupported recovery-lift claim. |

Test harness proposal for Phase 1: Vitest + `convex-test`, fake clock/random/provider and scheduled-function/concurrent-execution/crash tests. Add ephemeral Redis/BullMQ integration only if BullMQ is retained; it is not required by the proposed Convex-native path. Use Playwright for tenant/session/digest UI flows when those surfaces ship. Add tests only after phase approval. I7/I8 ingestion and global no-send/I5 foundations start in Phase 1; classifier/media/read-only regressions in Phase 2; I1-I8 full positive/negative send coverage gates Phase 3 and is rerun in every later phase.

Proposed classifier release gate, not a measured result: buying-signal precision >=90% on a held-out consented/redacted corpus, with >=100 predicted-positive examples overall; report recall, confidence intervals and English/Pidgin/Yoruba/Igbo/code-mixed slice support without inventing a target for recall. Under-supported or poor-precision slices stay review-only. Obtain seller labels; synthetic examples alone cannot validate the Nigerian market. Lead priority uses explainable rules and age/value evidence, not an uncalibrated probability of purchase.

Metric definitions: captured leads = unique customer-initiated DM profiles in period (qualified buying leads separate); replied buyers require an actual later inbound message linked to an accepted follow-up, not a cancelled task; follow-ups sent count distinct accepted follow-up intents, not drafts/digests; missed opportunities count open qualified overdue opportunities, not monetary losses; orders/payments/recovery use explicit event timestamps and business timezone. Unknown values display unknown. Adoption/retention and confirmed recovery should be reported separately; none is currently validated.

## Five biggest risks

| Risk | Mitigation and launch signal |
| --- | --- |
| 1. Seller number restriction/ban and lost trust | Written unofficial-provider disclosure; warm inbound-only scope; one-at-a-time dispatch, jitter, warm-up, conservative caps, kill switch and delivery-failure tripwire before sending. Rate limits reduce risk, never promise ban prevention. Signal: failure/unknown trends and connection-state changes. |
| 2. Cross-tenant exposure and unlawful personal-data handling | Verified identity/event source, complete authorization tests, credential encryption, minimization, retention/deletion and vendor/legal review. Signal: denied-access tests, deletion SLA and secret/log scanning. Do not onboard real data until gated. |
| 3. Duplicate/stale sends across unreliable provider/queues | Transactional inbox/outbox, durable intent keys, revisions/fencing, final eligibility checks and no retry on ambiguity. Pin provider contract; test crash windows/Redis loss/reconnect ordering. Signal: unknown sends, queue age, duplicate suppressions and DLQ age. |
| 4. Wrong local-language intent or invented business facts | Precision-led labeled evaluation, abstention/manual review, versioned classifier, grounded templates and constrained AI drafts; media manual-first. Signal: false-positive slices, seller rejection reasons and unsafe-draft rejection rate. |
| 5. Inflated attribution or an unused seller workflow | Claimed/confirmed separation and auditable net-payment ledger; queue/digest instead of dashboard dependence. Signal: evidence-complete recovery, seller action time, daily action rate and buyer reply rate. No fictitious default revenue or unsupported causal lift. |

## Assumptions, blockers and review handoff

**Assumptions for review (not blocking discovery):** one solo owner/one active WhatsApp session per business initially; existing stack retained; business timezone defaults to `Africa/Lagos`; response window defaults to existing 120 minutes but becomes versioned configuration; no historical import unless explicitly scoped; text-first capture; AI and automation off during read-only pilot; no payment processor, CRM campaign builder, catalog rewrite or language-model upgrade in foundation. Currency/window/retention defaults above require review before the relevant phase, not speculative implementation now.

**Owner clarification, 2026-10-27:** no deployment serves real sellers; Evolution Go is reported to be the latest build; no worker exists and the owner considers one unnecessary. The owner supplied `https://docs.evolutionfoundation.com.br/evolution-go`, and its relevant public contracts have now been reviewed. Real-seller migration and locating documentation are no longer blockers. The exact deployed build and conformance to those documents remain unverified. Existing development data/sessions remain protected.

The Phase 0 decisions were resolved for local Phase 1 implementation:

1. **Queue decision:** accepted Convex-native scheduled functions/crons with durable retry/dead-letter records and no separate worker.
2. **Provider qualification:** Record the deployed Evolution Go version/tag/commit (or image digest) before real integration, then compare its Swagger and redacted fixtures against the reviewed public contracts. The documentation location is resolved; do not ask for it again. Latest is a moving label, not a reproducible deployment identifier. This does not block separately approved local fake-source work; do not send credentials or raw customer data in the chat.

The owner subsequently approved starting Phase 1. No deployment, migration or provider call was approved by that instruction; local fake-source implementation proceeded without those operations.

**Shipped now:** this discovery packet, source-backed audit, two proposed ADRs, phase/invariant acceptance plan and static-check baseline. **Cut/deferred:** all runtime fixes, dependencies, migrations, tests implementation, deployments, sends and feature work. **Recommended next:** approve Phase 1 scope, then foundation auth/event/no-send safety with fake data before any live connection. No next phase begins without your approval.
