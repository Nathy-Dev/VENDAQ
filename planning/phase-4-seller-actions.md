# Phase 4: Seller Actions

## Outcome

Phase 4 turns safe follow-up tasks into a ranked seller work queue. It adds explicit seller-recorded order outcomes, awaiting-payment reminders, stalled-inquiry actions, and a copyable digest preview without introducing any provider message send.

## Acceptance criteria

- Due actions are ranked with awaiting-payment reminders before buying signals and stalled inquiries.
- Each action explains why it exists, shows the triggering evidence, provides a guarded draft, and exposes an estimated value.
- Copying a draft or opening WhatsApp does not record a send.
- A manual-send claim requires an idempotency key, a current conversation revision, and an actionable task.
- Duplicate action keys do not duplicate events or orders.
- Seller-recorded orders follow explicit legal status transitions only.
- Awaiting-payment orders create a deferred, policy-limited reminder that remains pending.
- Inquiry messages create deferred stalled-opportunity tasks that later conversation activity cancels.
- One business cannot read or mutate another business's actions or orders.
- No Phase 4 flow calls Evolution Go message endpoints.

## Shipped

- Ranked action queue with reasons and estimated values.
- Seller-controlled copy, WhatsApp open, manual-send claim, skip, won, and lost actions.
- Seller-recorded orders and payment-state transitions.
- Awaiting-payment and stalled-inquiry task creation using Phase 3 timing policy and safe templates.
- Digest preview for copy/manual use only.
- Additive Phase 4 migration checkpoint with no historical action inference.

## Cut

- WhatsApp delivery of the seller digest.
- Provider-confirmed sends, delivery, payments, or order values.
- Automatic customer messaging.

## Recommendation

Validate queue usefulness with synthetic and internal data before changing ranking weights. Real seller deployment remains outside this implementation handoff.
