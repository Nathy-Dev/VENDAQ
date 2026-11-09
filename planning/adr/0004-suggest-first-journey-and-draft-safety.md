# ADR 0004: Legal journey transitions and guarded suggest-first drafts

## Status

Accepted for Phase 3.

## Decision

- Represent the customer journey with an explicit legal-transition graph. Inbound evidence may establish `engaged` and advance `engaged -> intent`; order, awaiting-payment, paid, and lost outcomes require explicit trusted operations.
- Create a follow-up task only from retained customer-DM evidence that has become a missed buying-signal opportunity. Link the task to the opportunity, interaction, conversation revision, trigger time, journey stage, and policy snapshot.
- Use an additive extension of the preserved `followUpTasks` table so existing data and later-phase code remain intact. Phase 3 records are distinguished by their opportunity linkage.
- Cancel pending work when either party has a newer message than the task trigger. Use provider event time for this comparison so out-of-order webhook delivery cannot revive stale work.
- Apply cooldowns, daily caps, local work hours, and quiet hours when a suggestion becomes actionable. These are attention and safety constraints, not evidence that a message was sent.
- Generate a deterministic template first. The only supported placeholder is `{name}`; invalid templates fall back to a safe default.
- Permit optional AI replacement only when both deployment and business flags are enabled. The AI receives no customer message or customer identity, cannot send, and must pass the same deterministic validator before persistence. Failure or unsafe output leaves the template in place.
- Keep Evolution Go dispatch blocked. Manual copy/open actions do not count as a PIPELIXR send and do not establish delivery or attribution evidence.
- Use Convex scheduled functions for task and AI work. The deployment has no worker and does not need one for this phase.

## Consequences

The queue is conservative, auditable, and safe under duplicate or out-of-order events. It may defer useful suggestions and cannot confirm whether the seller actually sent a copied draft. That limitation is preferable to inventing delivery evidence or risking duplicate outreach through an unqualified provider contract.
