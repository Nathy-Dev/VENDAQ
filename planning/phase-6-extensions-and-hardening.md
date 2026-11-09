# Phase 6: Extensions and Hardening

## Outcome

Phase 6 exposes retained Status-view observations for manual review, records interest in a future automated tier, and surfaces connection risk while keeping all dispatch blocked.

## Acceptance criteria

- Status viewers are hidden until the business explicitly enables the list.
- The list exposes only deployment-keyed opaque identity hashes and observation metadata.
- Status observations never create customers, phone mappings, follow-up tasks, or outreach.
- A business may record automated-tier interest, but the setting never enables dispatch.
- Readiness always reports dispatch as unqualified until provider send idempotency and timeout reconciliation are qualified.
- The report includes connection state, kill-switch state, recent provider/processing risk events, and clear blocking reasons.
- Evolution Go message, read, reaction, presence, group-send, and instance-delete paths remain fail-closed.
- Synthetic tests exercise tenant isolation, idempotency, ranked action volume, and no-network behavior.

## Shipped

- Manual, opt-in Status viewer list.
- Automated-tier interest flag with an explicit unavailable result.
- Ban-risk/readiness panel and recent failure count.
- Expanded privacy deletion for orders, seller action events, and revenue attribution records.
- Additive Phase 6 migration checkpoint with no Status-to-customer backfill.

## Cut

- Automated sending, warm-up dispatch, throttled dispatch, or provider delivery monitoring.
- Phone resolution for WhatsApp LIDs or identity hashes.
- Status-view outreach and automatic lead creation.
- Real provider load testing.

## Recommendation

Keep the automated tier unavailable until a non-production qualification proves provider-side idempotency, timeout reconciliation, delivery evidence, kill-switch behavior, and conservative rate controls.
