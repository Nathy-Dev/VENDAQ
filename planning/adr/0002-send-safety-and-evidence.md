# ADR 0002: fail-closed sending and evidence-based recovery

Date: 2026-10-27. Status: **accepted for the no-send Phase 1 boundary on 2026-10-27**.
Scope: safety policy and provider qualification, not permission to send.

## Context and PM/engineering resolution

The product promises no cold bulk outreach, cancellation of stale work, idempotent sends and honest recovered revenue. Evolution Go is unofficial. The owner supplied its official documentation, reviewed in the [contract review](../evolution-go-contract-review.md). The deployed `0.7.2` build was later tested in the [automated-send qualification](../evolution-go-send-qualification.md): repeated caller IDs entered the send path, `/message/status` could not reconcile those IDs, and a client timeout remained unknown. Local `sendText` returns `Promise<void>` and supplies no caller ID (`convex/evolutionGoClient.ts:517`). A database transaction cannot atomically commit with a WhatsApp send. Retrying after a timeout might send twice; refusing to retry might miss a recovery opportunity.

**Recommendation:** favor missed recovery over duplicate outreach. Internal requests/effects must be idempotent; external submission has a durable at-most-once safety boundary when provider-side deduplication cannot be established. Do not claim exactly-once delivery. If the business requires both guaranteed retry delivery and zero duplicates, dispatch remains blocked until the provider contract supports that guarantee. This tradeoff needs owner review, not silent weakening of invariant I8.

## Historical source-only evidence register

This table preserves the initial local-source audit, before the documentation link was supplied. Its unknowns are superseded where documented in the [official contract review](../evolution-go-contract-review.md). These are **shapes the repository attempts to handle**, not observations from a verified deployed Evolution Go build. No live provider calls or payload capture occurred in Phase 0.

| Capability | Repository evidence | Verified provider contract / consequence |
| --- | --- | --- |
| DM/owner events | `convex/http.ts:278` normalizes message envelopes including keys and Go `Info` fields; `receiveMessage` accepts optional message ID/fromMe/timestamp. | Build, stable IDs, ordering, retries, timestamp units and fromMe fidelity unknown. Require redacted fixtures and fake replays, then an explicitly approved non-production contract test. |
| Status read receipts | `convex/http.ts:102` accepts `RECEIPT`, `READ_RECEIPT`, `MESSAGES_READ`, nested receipt variants and `status@broadcast`. | No captured samples prove these are actual views rather than another acknowledgement. Validate event meaning against the pinned provider. |
| Custom Status event | `convex/http.ts:278` handles `MESSAGES_UPSERT` with `type=status_view`; `convex/http.ts:591` also handles `STATUS`, `STATUS_FIND`, `STATUS_UPDATE`. | Multiple paths may describe the same view. Establish a semantic dedup key; never treat parser breadth as confirmed capability. |
| Viewer identity | `convex/http.ts:135` and `convex/whatsapp.ts:727` discard `@lid` viewers; `statusViews.viewerPhone` requires a string. | LIDs are opaque identities, not phone numbers and not proof of a fake viewer. Preserve verified observations with unresolved identity; never strip a LID into a routable phone or invent a mapping. |
| Completeness | No provider fixture documents read-receipt settings/coverage. | Read receipts can suppress view visibility. A viewer list is incomplete; counts are observed views, never all viewers or a conversion denominator for the whole audience. |
| Outbound acceptance/delivery | `sendText` calls `/send/text` and discards the response; text/media paths add 3-12 second sleeps. | Returned message ID, idempotency keys, timeout reconciliation and receipt semantics unknown. An HTTP success is not proof of delivery. Preserve accepted/delivered/failed/unknown separately. |
| Webhook authentication | `convex/http.ts:40` uses tokens/header values as routing candidates. | No verified request-authentication/replay contract. Require supported signature verification or a trusted authenticated ingress/instance-secret scheme; never resolve tenant before authentication or use a display name as a secret. |
| Seller self-chat/actions | `convex/whatsapp.ts:2521` implements commands from supplied admin phone identities, not a daily interactive digest. | Confirm verified self-chat delivery and native button callback semantics. No unsupported one-tap promise; authenticated web confirmation is an explicit fallback proposal. |

Phase 1 provider qualification must record build/version, field schema, credential mechanism, sample hashes/provenance, replay/acknowledgement behavior and supported features. Scrub phones, message text, tokens and QRs from committed fixtures. If stable event identity cannot be established, quarantine ambiguous events rather than use content/time guessing to drive sends. Status uncertainty never blocks the DM foundation; it blocks Status features.

## Dispatch contract

1. Global phase gate denies all application messaging in Phases 1/2, including digests, read marking, reactions and typing. Session authentication/protocol traffic is unavoidable to connect and must be disclosed; it is not permission to send user content. Real read-only qualification checks provider-side auto-read/auto-reply settings too.
2. Customer-initiated DM proof is necessary for system-assisted follow-ups. An imported contact, phone number, group membership or Status view is not sufficient. No recipient-list/campaign send endpoint. Verified seller-self digest is a separate opt-in operational purpose, not cold prospect outreach or revenue.
3. Persist seller approval bound to task, content hash and current conversation/policy versions. Approval of one draft cannot authorize a different draft or renewed task. Native callback identity must be verified; fallback links are tenant/user/expiry/action scoped and never mutate on GET. Repeated taps return the original result.
4. Before dispatch, revalidate all eligibility, warm-up/throttling, business hours/quiet hours, cooldown, caps, connection, kill switch and opt-out rules; reserve quotas and compare revisions atomically. Pending verified inbox activity fences dispatch until reply cancellation is processed, independently of classification. Per-business serialization spans workers. Seller manual phone activity updates conversation state but cannot be prevented by PIPELIXR.
5. Persist a submitting record before network I/O. Crash/timeout after that point becomes unknown unless a matching provider receipt proves acceptance or definitive rejection. Unknown blocks another send to that customer pending reconciliation and conservatively consumes the reservation. A new worker/approval/key cannot bypass it. Only provably unsubmitted/rejected attempts may be retried with the same logical intent.
6. Provider message ID/echo/receipt reconciles the intent idempotently, scoped to business and session. Late/duplicate receipts cannot regress state or double-count sends. Policy-denied work records a reason and is cancelled/deferred, not silently reported as sent. Failure spikes pause dispatch and alert the seller outside WhatsApp as needed.

Finite configured throttles reduce ban risk; they never eliminate it. Exact cooldown/cap/warm-up/jitter/tripwire values need a conservative non-production qualification and explicit policy review before the first real send; do not reuse the legacy 250/day value as a safety recommendation. Safety cannot wait for Phase 6.

## Attribution contract

Store an immutable eligibility snapshot at accepted send-time: tenant/customer/conversation/opportunity, response-window version and deadline, unanswered trigger, last reply/revision, follow-up ID and provider acceptance evidence. An order linked to that opportunity must be explicitly marked won in the interval `(acceptedAt, acceptedAt + N days]`; use precise timestamps, not rounded dates. Proposed `N=7`, configurable and versioned.

- Attribute an order once to its first qualifying follow-up within that interval. A future unrelated order cannot inherit an old customer's entire lifetime value. Seller digests and normal on-time replies never qualify.
- Claimed recovery records seller-entered order value and attribution claim, not an estimate. Confirmed recovery additionally requires verified payment evidence and is capped by the actual net paid order amount. Until independent verification is available, confirmed recovery is zero, not equal to claimed.
- Provider-confirmed delivery failure without later delivery evidence makes the send ineligible; unknown acceptance is ineligible. An eventual receipt can trigger a versioned recomputation using the actual accepted timestamp, not the reconciliation time. Missing delivery receipts do not imply success or failure; label the evidence level.
- Refunds, reversals and corrected order links append compensating entries. Duplicate webhooks/mark-won requests never duplicate attribution. Snapshot/daily metrics are rebuildable projections, not financial authority.
- AI/model/provider identity never establishes price, stock, payment or revenue truth. Payment-proof screenshots require review and verification, not automatic Paid state. Estimated opportunity value is visibly separate from both claimed and confirmed recovery.

This is conservative rule-based attribution, not a causal experiment. Claiming incremental lift would require a separate approved measurement design; no invented 3x claim. The evidence chain, versioned eligibility tests and claimed/confirmed distinction take precedence over a larger dashboard number.
