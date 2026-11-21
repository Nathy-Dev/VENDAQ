# Billing production runbook

This runbook activates the implemented Paystack subscription system. It does not authorize a production change by itself. Identify the exact Convex production deployment, take a backup, and obtain fresh approval before every production environment, migration, or deploy command.

## Commercial model

| Plan | Monthly | Annual | Assisted conversations | Automation | Enabled groups |
| --- | ---: | ---: | ---: | --- | ---: |
| Starter | NGN 9,900 | NGN 99,000 | 300/month | No | 0 |
| Growth | NGN 24,900 | NGN 249,000 | 1,500/month | Yes | 5 |
| Scale | From NGN 59,900 | Contract | 5,000/month baseline | Yes | 25 baseline |

New businesses receive one 14-day Growth trial capped at 100 assisted conversations. Failed renewals receive one fixed seven-day grace period. The system blocks further paid-feature use at the allowance; it never creates an unapproved overage charge. Scale is sales-assisted and is not self-serve.

## 1. Create Paystack plans

Create four recurring plans in the live Paystack account. Amounts must match exactly; the backend rejects mismatched transaction amounts and plan codes.

- Starter monthly: NGN 9,900, monthly interval.
- Starter annual: NGN 99,000, annually.
- Growth monthly: NGN 24,900, monthly interval.
- Growth annual: NGN 249,000, annually.

Record each `PLN_...` code. Do not reuse test plan codes in production.

## 2. Configure the production Convex environment

Set these values only after the deployment guard confirms the production target:

```text
PAYSTACK_SECRET_KEY=sk_live_...
PAYSTACK_PLAN_STARTER_MONTHLY=PLN_...
PAYSTACK_PLAN_STARTER_ANNUAL=PLN_...
PAYSTACK_PLAN_GROWTH_MONTHLY=PLN_...
PAYSTACK_PLAN_GROWTH_ANNUAL=PLN_...
SITE_URL=https://app.pipelixr.com
```

The existing `SESSION_ENCRYPTION_KEYS` and `SESSION_ENCRYPTION_KEY_VERSION` values are also required because Paystack cancellation tokens are encrypted at rest. `SITE_URL` must be the canonical HTTPS application origin; checkout returns to `/billing`.

Never expose the Paystack secret or plan codes through `NEXT_PUBLIC_*` variables. Keep `sk_test_...` in non-production and `sk_live_...` only in production.

## 3. Register the Paystack webhook

Use this URL in the live Paystack dashboard:

```text
https://<production-deployment>.convex.site/api/webhook/paystack
```

The endpoint verifies `x-paystack-signature` with HMAC-SHA512 before parsing or storing an event and rejects bodies over 256 KiB. The implementation handles:

- `charge.success`
- `charge.failed`
- `invoice.payment_failed`
- `subscription.create`
- `subscription.enable`
- `subscription.disable`
- `subscription.not_renew`

Unknown signed events are acknowledged and recorded as ignored so Paystack does not retry indefinitely. Event processing and payment recording are idempotent.

## 4. Validate before deployment

Run the local verification matrix:

```powershell
npm run typecheck
npm test
npm run lint
npm run build
git diff --check
```

Then push the code to a non-production Convex deployment and complete one checkout with Paystack test mode. Confirm checkout verification, the signed webhook, cancellation, a duplicate webhook replay, and read-only expiry behavior.

## 5. Migrate existing businesses

Back up production first. Run `internal.migrations.billingV1` with `dryRun: true`, starting without a cursor and continuing with each returned cursor until `complete` is true. Review the processed count.

After fresh production approval, repeat with `dryRun: false`, page by page. The migration is additive and idempotent: every foundation business without a subscription receives one 14-day Growth trial; businesses that already have a subscription are skipped.

Do not restart a partial run from an invented cursor. Use the exact cursor returned by the preceding page.

## 6. Production smoke test

1. Create a designated internal seller account and confirm one Growth trial exists.
2. Complete a live, low-risk Starter monthly checkout with an approved company payment method.
3. Confirm `/billing` shows the active plan, exact amount, renewal date, and zero usage.
4. Confirm the Paystack dashboard shows the same customer, subscription, plan, and transaction reference.
5. Replay the same signed webhook body and confirm no second payment or subscription is created.
6. Cancel renewal from `/billing`; confirm Paystack disables renewal while access remains active through period end.
7. Refund or otherwise reconcile the smoke transaction according to finance policy. A refund does not currently auto-revoke access; handle it operationally and record the decision.

## 7. Operations and support

- Active subscribers cannot self-switch plans. Checkout returns `PLAN_CHANGE_REQUIRES_SUPPORT`; support must cancel the old renewal and coordinate the replacement plan to avoid duplicate subscriptions.
- A failed renewal starts a fixed seven-day grace period. Repeated failure events do not extend it.
- After expiry, the workspace is read-only and automation is disabled. Automatic business deletion is not part of billing; use the existing privacy/deletion workflow after the stated retention review.
- No add-on or overage purchases are implemented. Never promise or manually charge an overage that the product cannot represent.
- Refund webhooks are not yet automated. Reconcile refunds in Paystack and update access through a reviewed operational procedure.

## 8. Rollback

To stop new purchases, remove or invalidate the live Paystack plan-code variables or disable the plans in Paystack; expect checkout to fail closed. To stop webhook processing, rotate the Paystack live secret in both systems in a coordinated incident procedure. Do not delete billing tables or subscription records.

Application rollback must retain compatible reads for the additive billing schema. If access must be restored during an incident, use a reviewed data repair against the exact business and preserve the provider references and payment audit trail.
