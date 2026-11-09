# ADR 0005: Seller Evidence and Conservative Attribution

## Status

Accepted for Phases 4 and 5.

## Decision

Seller actions are stored as explicit, idempotent claims. Copying a suggestion or opening WhatsApp is not a send. Only the seller's explicit manual-send action creates a send claim.

A recovered-revenue claim requires a missed-opportunity task, a manual-send claim, and a paid order recorded inside the configured window. The attributed amount is stored as `claimedValue`. `confirmedValue` remains zero until an independent payment source verifies it.

## Consequences

- Dashboard wording must use "manual follow-up claims" rather than provider-confirmed sends.
- Paid order status is seller-recorded and does not confirm payment independently.
- Duplicate action keys and duplicate paid updates cannot duplicate attribution.
- Historical conversations and orders are not backfilled into revenue claims.
- Attribution is conservative, inspectable, and reversible without inflating confirmed revenue.
