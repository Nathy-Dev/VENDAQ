# Phase 2: Read-only classification and missed revenue report

## Seller outcome

A seller can see exact unanswered messages that expressed an explicit buying signal after the configured response window, then label real messages to measure classifier quality. Phase 2 does not contact customers or claim recovered revenue.

## Acceptance criteria

1. Every newly captured customer message receives one versioned deterministic classification; owner messages are not classified.
2. Only explicit `buying_signal` messages create a response-window candidate.
3. The report remains empty before the candidate deadline and shows the exact retained message after the deadline.
4. Any seller reply after the trigger closes pending or missed evidence, including out-of-order webhook delivery.
5. Duplicate provider events create one interaction and one opportunity.
6. Owner authorization and tenant isolation apply to reports, labels, and evaluation.
7. A human label never overwrites the stored classifier prediction.
8. Evaluation reports buying-signal TP, FP, FN, precision, recall, F1, and sample size.
9. Customer deletion and retention remove messages, labels, and opportunity evidence.
10. No AI call, customer send, read marking, reaction, typing, digest, ranking, estimated value, or follow-up task is introduced.

## Shipped

- `keyword-v1` classifier behind a replaceable interface.
- Atomic ingestion-time predictions and idempotent opportunity creation.
- Scheduled promotion to missed evidence plus maintenance reconciliation.
- Seller-facing missed report with exact message, contact, response-window snapshot, rule, version, and confidence.
- Tenant-safe response-window configuration for future candidates.
- Human labeling tool and in-product evaluation metrics.
- Offline evaluation command: `npm run classifier:eval -- tests/fixtures/classifier-eval.json`.
- Additive schema and a Phase 2 migration checkpoint with no historical backfill.

## Cut or deferred

- AI or hybrid classification, transcription, OCR, and media download.
- Follow-up task creation, suggested messages, sending, ranking, estimated value, attribution, and daily digest.
- Historical opportunity backfill.

## Limitation and recommendation

The included fixture proves deterministic behavior, not Nigerian market quality. Collect at least 100 tenant-scoped human labels across English, Pidgin, Yoruba, Igbo, and manual-review media before expanding rules or beginning Phase 3. Review false positives first because unwanted follow-up would cost trust.
