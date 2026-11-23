# Provider contingency and incident strategy

## Operating position

Pipelixr currently supports authorized automation through Evolution Go with explicit seller consent. The connection layer is replaceable: product records, authorization, dispatch state, learning data, and customer context remain in Convex rather than becoming provider-owned state.

## Conservative rollout limits

- Default maximum: 50 assistant dispatch reservations per business in a rolling 24-hour window.
- Default per-recipient cooldown: 30 seconds.
- One-to-one and group automation require separate opt-in; every group starts silent.
- A complete Teach Pipelixr playbook, healthy connected session, paid automation entitlement, and inactive kill switch are rechecked immediately before submission.
- A send that reaches `submitting` is never automatically retried after an uncertain provider result.
- Increase limits only after reviewing reply-quality feedback, duplicate-send evidence, provider incidents, and labelled-message coverage.

## Monitoring and incident process

1. Health polling runs every minute and records connection state transitions.
2. `connectionIncidents` opens on disconnected/error transitions and resolves on reconnection.
3. Assistant dispatches persist `reserved`, `submitting`, `accepted`, `failed`, `unknown`, or `cancelled` state.
4. Repeated provider message IDs are recorded as duplicate-send evidence.
5. Seller support requests are created from Workspace Health and appear in Admin Operations.
6. For an unknown send, the operator and seller must check the WhatsApp chat before any manual resend.
7. For a connection incident, keep the kill switch active if delivery or authorization cannot be trusted; never diagnose using copied credentials or raw private conversation content.

Severity guidance:

- SEV-1: cross-tenant exposure, unauthorized sending, repeat sending across multiple businesses, or credential compromise. Disable affected automation immediately and preserve records.
- SEV-2: persistent provider outage, material unknown-send spike, or repeated disconnects. Pause affected businesses, communicate fallback, and reconcile sessions.
- SEV-3: isolated connection, ingestion, transcription, or reply-quality issue. Track through the structured support queue and normal retry/review paths.

## Seller fallback

- Inbox history, opportunities, suggested actions, and recorded outcomes remain accessible when the provider connection is unavailable.
- The seller can work directly in WhatsApp and return to Pipelixr to record the result.
- Pipelixr must not claim a message failed merely because provider confirmation is missing; use `unknown` and ask the seller to verify the chat.
- Do not create a second provider instance until the prior remote instance is reconciled or proven absent.

## Provider contingency

- Maintain configuration flags that can stop new provider connections and automation without disabling the workspace.
- Keep one tested non-production provider environment for contract, webhook, QR, health, and send qualification.
- Export only minimal connection identifiers and operational timestamps for incident work; never export tokens, QR payloads, or customer message content into support tickets.
- If Evolution Go becomes unavailable, keep the application read-only for connection-dependent actions while preserving business data and manual workflows.

## Official integration strategy

Where commercially feasible, pursue the official WhatsApp Business Platform as the long-term primary integration:

1. Validate target seller eligibility, Meta business verification burden, template-message constraints, pricing, onboarding conversion, and supported Nigerian payment/identity flows.
2. Add an adapter implementing the existing connection, webhook normalization, health, and send contracts rather than branching product logic.
3. Pilot with selected verticals and compare connection completion, delivery reliability, cost per assisted conversation, reply latency, and support volume.
4. Offer controlled migration with explicit seller approval; never silently move a number or duplicate message traffic between providers.
5. Retain the contingency provider only if contractually and operationally justified after the official integration meets reliability and unit-economics requirements.

## Review cadence

Review weekly during the initial rollout: connection completion, incidents, unknown/duplicate sends, automation opt-in, wrong/unsupported replies, buying-signal precision, response-time change, retained businesses, and labelled evidence coverage. Record limit changes and provider decisions in an ADR.
