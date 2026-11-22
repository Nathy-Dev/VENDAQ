# Admin dashboard runbook

The production admin console is available at `/admin` and contains four read-only surfaces: overview, businesses, operations, and billing.

## Access

Admin authorization is enforced inside every Convex admin query. The browser route is not the security boundary.

1. Find the exact Auth.js subject for each operator. Subjects use the existing canonical forms, such as `google:<provider-account-id>` or `credentials:<convex-user-id>`.
2. Set `ADMIN_USER_IDS` in the target Convex deployment to a comma-separated list of those subjects.
3. Deploy Convex functions and the Next.js application.
4. Sign in as an allowed operator and open `/admin`.

If `ADMIN_USER_IDS` is absent or empty, the console fails closed for everyone. Removing a subject revokes its access on the next query.

## Data and safety

- Overview, operations, and billing remain read-only. Business details include a guarded permanent account-deletion command.
- Deletion requires the admin to type the exact business name. It immediately disables automation and seller access, disables an active Paystack subscription, revokes the WhatsApp session, and removes tenant records in bounded background batches.
- If Paystack cancellation or provider disconnection cannot be confirmed, deletion fails closed and leaves the workspace disabled for operator review.
- Credential accounts are removed from the local users/auth tables. Google identities cannot be deleted from Google; their Pipelixr business and data are removed.
- Queries are bounded to protect production database reads. The UI shows a snapshot notice when a safety limit is reached.
- Customer message bodies, WhatsApp tokens, Paystack secrets, payment references, and provider credentials are never returned.
- The business CSV export is generated in the operator’s browser from the already authorized table data.

## Verification

Before release, run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

The authorization regression tests are in `tests/admin.test.ts`.
