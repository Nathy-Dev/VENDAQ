# Phase 3: Journey and suggest-first follow-up engine

## Seller outcome

A seller receives a small, policy-limited queue of safe draft follow-ups for customer-initiated buying signals that exceeded the response window. The seller can copy the draft or open a routable WhatsApp chat, then mark the task handled or skip it. PIPELIXR does not dispatch a customer message in Phase 3.

## PM and engineering conflict

The brief describes suggest-first as “one tap” sending, while the accepted provider-safety ADR blocks dispatch until the deployed Evolution Go build proves timeout reconciliation and repeat-ID idempotency. Implementing a backend send button now would weaken the no-duplicate invariant without evidence.

**Resolution:** safety wins. Phase 3 provides one-tap copy/open-WhatsApp assistance, not system send. The provider `/send/text` path remains blocked with `OUTBOUND_DISABLED`. A future approved dispatch phase must qualify the provider contract and revalidate every policy at send time.

## Acceptance criteria

1. Journey changes use an explicit legal transition graph; payment-related text never marks a customer paid.
2. A newly missed, customer-initiated buying signal creates exactly one follow-up task and one retained draft.
3. Duplicate webhook delivery, scheduler replay, or task creation cannot duplicate the task.
4. A customer or seller message after the trigger cancels a pending task, including out-of-order delivery.
5. Per-customer cooldown, local work hours, quiet hours, and a per-business daily suggestion cap constrain when a task becomes actionable.
6. Only the supported customer-name placeholder is accepted. Unsafe templates fall back to a deterministic safe template.
7. Drafts never introduce prices, availability, discounts, URLs, account numbers, or payment details.
8. AI is separately disabled by default. When both business and deployment flags enable it, timeout, provider failure, or unsafe output retains the safe template.
9. Queue queries and mutations enforce tenant ownership. Opaque WhatsApp LIDs are never converted into phone numbers.
10. Customer deletion and retention remove tasks and drafts with their source evidence.
11. Convex scheduled functions provide reconciliation; no worker or BullMQ runtime is introduced.
12. No Phase 3 code calls Evolution Go messaging endpoints.

## Shipped

- Explicit journey-state helper and ingestion-time engagement/intent progression.
- Additive follow-up task evidence: source opportunity, trigger, conversation revision, journey snapshot, policy snapshot, draft hash/source/version, AI state, and cancellation reason.
- Idempotent task creation when a missed-opportunity candidate is promoted.
- Event-time cancellation for either party’s later message.
- Configurable cooldown, daily cap, work hours, quiet hours, and timezone-aware deferral.
- Safe deterministic template rendering plus a narrow optional Groq suggestion action behind deployment and business flags.
- One shared safety validator for templates and AI output.
- Seller queue with copy, manual WhatsApp open, handled, and skip controls.
- Additive Phase 3 migration checkpoint with no historical task backfill.
- Privacy deletion and retention cleanup for task drafts.

## Cut or deferred

- Backend/provider send, delivery status, retries, automatic sending, warm-up, jitter, and ban-risk tripwires.
- Ranking, estimated value, outcomes, payment reminders, stalled-opportunity detection, and seller WhatsApp digest; these remain Phase 4 scope.
- Recovered-revenue attribution; this remains Phase 5 scope.
- Historical follow-up task backfill.

## Metrics and recommendation

Phase 3 can measure suggestions created, deferred, cancelled before action, copied/opened only in the browser session, handled, skipped, template fallback rate, and AI fallback rate. It cannot honestly report follow-ups sent or revenue recovered because PIPELIXR does not dispatch or observe the seller’s manual send.

Before Phase 4, review real seller labels and queue cancellation/skip rates. Keep automated dispatch deferred until a non-production provider qualification proves idempotent submission and timeout reconciliation.
