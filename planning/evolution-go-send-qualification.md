# Evolution Go automated-send qualification

Date: 2026-10-28. Result: **provider transport qualified; automated sending not qualified**.

This report records the owner-authorized disposable-recipient test against the local Evolution Go service exposed through the configured webhook path. It contains no API keys, instance tokens, phone numbers, ngrok URL, message contents, customer data or raw payloads.

## Qualified environment

- Intended and observed binary: Evolution Go `0.7.2` from `/app/VERSION`.
- Image digest: `sha256:d6529bdeae0897e27d73b4c64fca459f78e94582775f26c2abb65cd24346f78c`.
- Deployed Swagger hash: `a198323614f73e310e7d5cd0591861cce3c0b142c93b728ae7c6635052f853f4`.
- Swagger endpoint: `/swagger/doc.json`.
- Convex production deployment checked read-only: `original-sparrow-842` (`https://original-sparrow-842.eu-west-1.convex.cloud`).
- One connected instance accepted instance-token authentication. The global API key could enumerate instances but could not send or query status.
- The disposable qualification recipient was configured outside source control and validated as a Nigerian international-format number.

## Bounded experiment

Six labelled API requests were authorized and issued. No ambiguous result was resent.

| Case | Requests | Observed result |
| --- | ---: | --- |
| Baseline unique caller ID | 1 | HTTP 200; response echoed the supplied caller ID. |
| Sequential repeat, same ID and payload | 1 | HTTP 200; response echoed the same caller ID. |
| Sequential collision, same ID and different payload | 1 | HTTP 200; response echoed the same caller ID. |
| Concurrent repeat, same ID and payload | 2 | Both returned HTTP 200 and the same echoed caller ID. |
| Controlled client timeout | 1 | Client timed out; provider log later recorded the send path once. No retry was attempted. |

The provider produced one INFO log entry per request using the redacted shape `Sending message to [PHONE] with ID [CALLER_ID]`: three entries for the baseline/collision ID, two for the concurrent ID and one for the timed-out ID. Repeat IDs therefore do not stop the deployed build from entering its send path. The optional request `id` is correlation input, not a qualified idempotency key.

## Reconciliation findings

- `POST /message/status` returned HTTP 200 with a null result for all three synthetic caller IDs after the requests completed.
- The Evolution Go users database contained no `messages.message_id` rows for those caller IDs.
- A bounded read-only scan of current production `interactions`, `statuses` and `statusViews` found no matching synthetic IDs.
- Production currently exposes the older table set and does not contain the new `deliveryReceipts` ledger from the local Phase 1-6 code.
- Provider logs prove that each request entered the send path. They do not prove recipient delivery, read state or provider-side suppression after that point.
- The controlled timeout cannot be classified as definitely unsubmitted. It remains `unknown`, and automatic retry would risk another message.

## Decision

The deployed contract is now qualified with these negative guarantees:

1. Do not rely on caller-supplied IDs for duplicate suppression.
2. Do not rely on `/message/status` to reconcile caller-supplied send IDs.
3. Treat client timeout or transport loss after submission begins as `unknown`.
4. Never automatically resend an `unknown` attempt.

Automated Evolution Go sending remains blocked. Enabling it requires the application-side dispatch contract in ADR 0002: a durable send ledger, typed gateway, atomic eligibility and quota reservation, `submitting`/`accepted`/`delivered`/`failed`/`unknown` states, late-receipt reconciliation, per-business opt-in, kill switch, conservative caps/cooldowns/jitter/warm-up, failure tripwire and invariant tests. Because the provider cannot supply idempotent retry, the supported safety model is conservative at-most-once submission: uncertainty may miss a follow-up rather than risk duplicate outreach.

## Qualification disposition

- **Pass:** pinned build, Swagger shape, authentication boundary, connected-instance selection and caller-ID echo.
- **Fail:** provider duplicate suppression, caller-ID status reconciliation and safe automatic retry after timeout.
- **Not established:** end-to-end delivered/read receipt correlation for these synthetic sends.
- **Production action:** none. The send hard-block remains in place.
