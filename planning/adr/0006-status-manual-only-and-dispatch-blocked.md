# ADR 0006: Status Is Manual-Only and Dispatch Remains Blocked

## Status

Accepted for Phase 6.

## Decision

Status observations may be shown only in an explicit opt-in viewer list. The UI exposes opaque hashed identities and never infers a phone number, customer, lead, or outreach task.

The automated-tier flag records business interest only. It does not unlock any send path. Dispatch remains unqualified because the deployed Evolution Go contract has not demonstrated provider-side repeat-send idempotency or safe timeout reconciliation.

## Consequences

- Status-view outreach remains manual and outside PIPELIXR.
- WhatsApp LIDs and read-receipt limitations remain visible product constraints.
- Risk monitoring can inform sellers without implying the provider is safe.
- The kill switch stays first-class even though current customer dispatch is fully blocked.
