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

- The console is read-only. It has no account suspension, billing mutation, message-send, or provider-control commands.
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
