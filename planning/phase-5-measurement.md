# Phase 5: Conservative Measurement

## Outcome

Phase 5 adds an auditable dashboard while keeping seller-entered evidence separate from independent confirmation.

## Acceptance criteria

- The dashboard reports leads, buyers replying after a claimed manual follow-up, manual follow-up claims, missed opportunities, orders, and paid orders.
- Recovered revenue requires a missed-opportunity task, a seller-recorded manual-send claim, and a seller-recorded paid order inside the configured window.
- One order produces at most one attribution record.
- Orders outside the window or without qualifying evidence do not contribute claimed recovered revenue.
- Seller-recorded evidence can increase claimed value but never confirmed value.
- Every attributed amount has an audit record containing task, order, timing window, state, values, and reason.
- Measurement queries are tenant-isolated and expose bounded-record warnings.

## Definitions

- **Claimed recovered revenue:** seller-recorded paid order value inside the configured attribution window after a seller-recorded manual follow-up on a missed opportunity.
- **Confirmed recovered revenue:** independently verified recovered payment value. This remains zero because no independent payment source is integrated.
- **Buyers replied:** unique customers with a captured inbound message after their first seller-recorded manual-send claim.

## Shipped

- Conservative dashboard metrics.
- Claimed-versus-confirmed separation.
- Attribution audit query and evidence reasons.
- Additive Phase 5 migration checkpoint with no historical revenue attribution.

## Cut

- Payment-provider reconciliation.
- Provider-confirmed WhatsApp send or delivery attribution.
- Historical backfill from ambiguous legacy records.

## Recommendation

Integrate an independent payment source before presenting any non-zero confirmed recovered revenue.
