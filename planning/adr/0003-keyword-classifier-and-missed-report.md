# ADR 0003: Versioned keyword classifier and missed-opportunity evidence

## Status

Accepted for Phase 2.

## Decision

- Classify only newly captured customer messages through the `MessageClassifier` interface.
- Use deterministic `keyword-v1` rules for English, Pidgin, and a deliberately small set of explicit Yoruba and Igbo buying phrases.
- Optimize buying-signal precision over recall. Non-text and shortened content is `manual_review`.
- Create a missed-opportunity candidate only for `buying_signal`; inquiries and payment messages remain visible but do not enter the report.
- Snapshot the configured response window on each candidate. A seller reply at or after the trigger closes pending or missed evidence.
- Store human labels separately from predictions. Evaluation re-runs the current classifier against labeled message content and reports binary buying-signal precision and recall.
- Do not backfill historical messages into the live report without a separately approved, evidence-reviewed migration.

## Consequences

The report is auditable and conservative, but it will miss implicit or market-specific buying language until real seller labels justify new rules. It is not recovered-revenue attribution, lead ranking, or a follow-up queue.
