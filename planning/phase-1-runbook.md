# Phase 1 non-production runbook

This runbook is gated. No commands here were run against a deployment during implementation.

## 1. Identify the target

Confirm the Convex deployment name/type and Evolution Go environment. Stop if either serves real sellers. Export or snapshot development data before any non-dry migration. Do not infer safety from a `dev` label alone.

## 2. Generate secrets offline

- Generate an RS256 key pair. Store only the base64 PKCS8 private key in Next.js; expose its public key through `/api/auth/jwks`.
- Generate independent random 32-byte values for `SESSION_ENCRYPTION_KEYS.v1` and `IDENTITY_HASH_KEY`, encoded as base64.
- Never reuse Evolution credentials or an Auth.js secret as an encryption/HMAC key.
- Keep old encryption-key versions while stored ciphertext still references them.

## 3. Configure both runtimes

Use `.env.example` as the inventory, not as a deployment command.

Next.js requires `NEXT_PUBLIC_CONVEX_URL`, Auth.js provider variables, `AUTH_JWT_ISSUER`, `AUTH_JWT_KEY_ID` and `AUTH_JWT_PRIVATE_KEY`.

Convex requires `AUTH_JWT_ISSUER`, `AUTH_JWT_JWKS`, encryption/HMAC keys, provider variables and policy overrides. `AUTH_JWT_JWKS` must resolve to the deployed `/api/auth/jwks` route.

Keep both provider qualification flags false until step 4 passes.

Defaults: 256 KiB webhook bodies, 16,000-character text capture, five attempts, two-second exponential base, 60-second leases, 50-record batches, 90-day messages/profiles, seven-day inbox/evidence/audit, two-minute QR lifetime, ten-second provider timeout, five-minute health checks, 15-minute auth windows, ten account attempts and 200 global attempts.

## 4. Qualify the deployed Evolution Go contract

Record the deployed build/version and a redacted copy/hash of its Swagger schema. With a disposable synthetic instance, verify:

1. `apikey` semantics for `/instance/all`, `/instance/create`, `/instance/connect`, `/instance/status`, `/instance/qr` and `/instance/disconnect`.
2. Create fields (`name`, `token`), connect fields (`webhookUrl`, `subscribe`, `immediate`) and returned instance ID.
3. Status fields `data.Connected` and `data.LoggedIn`; QR field `data.Qrcode` or the qualified equivalent.
4. Webhook envelope `event`, `data`, `instanceId`, `instanceToken`; owner replies, multiple receipt IDs, LIDs and lifecycle event spellings.
5. A 2xx acknowledgement after durable commit and provider retry behavior after deliberate non-2xx responses.

Do not test send/read/reaction/presence endpoints in Phase 1. If fields differ, update the narrow client and fake contract tests before enabling connection.

## 5. Validate locally

```powershell
npm test
npm run typecheck
.\node_modules\.bin\tsc.cmd --noEmit -p convex/tsconfig.json
npx eslint convex/auth.config.ts convex/connections.ts convex/foundation.ts convex/foundationHttp.ts convex/ingestion.ts convex/lib convex/maintenance.ts convex/migrations.ts src/components/ConvexClientProvider.tsx src/components/FoundationGate.tsx src/components/FoundationWorkspace.tsx src/lib tests vitest.config.mts auth.ts
npm run build
```

The implementation produced 38 passing tests, successful root/Convex TypeScript checks, a successful production build, zero lint errors (33 preserved legacy warnings), and zero `npm audit` vulnerabilities. Repeat the same matrix in target CI before deployment.

Do not run `convex/test.ts`; it is a preserved legacy live-provisioning probe and is phase-disabled.

## 6. Migration gate

- Run `internal.migrations.foundationV1` first with `dryRun: true` and its returned cursor until complete.
- Review counts and ambiguous owners. Non-dry mode sets old records to `foundationVersion=0`, kill switch on and AI off. It preserves development connection fields unless `scrubLegacyCredentials: true` is explicitly supplied.
- After backup and credential-revocation review, run non-dry with the returned cursor exactly. Cursor mismatch fails closed.
- Run `internal.migrations.cancelLegacyTasks` dry first; non-dry also cancels scheduled function IDs.
- Never promote a legacy business to `foundationVersion=1` until its canonical `google:` or `credentials:` subject is verified.

## 7. Non-production smoke test

1. Sign in again so the session carries a canonical subject.
2. Create a new foundation workspace or operator-map one reviewed legacy owner.
3. Confirm connect is blocked while either provider qualification flag is false.
4. Set both true only after step 4. Accept disclosure, connect and scan the disposable number's QR.
5. Send one synthetic direct text, one non-text item and one owner reply. Confirm one contact/conversation, manual-review metadata, no AI/task/send activity and no raw token/payload logs.
6. Replay the same webhook 100 times. Confirm one stored message.
7. Submit invalid token/instance and malformed authenticated events. Confirm 401 or minimized dead-letter state.
8. Request deletion. Confirm immediate disappearance, completed privacy job and replay suppression.
9. Revoke connection. Confirm new webhook authentication fails and disconnect completes or surfaces a dead letter.

## 8. Rollback and incidents

- Immediate kill: revoke the local session and remove PIPELIXR from WhatsApp Linked devices. Keep provider flags false.
- Do not reenable legacy crons, worker proxy behavior or legacy public functions as rollback.
- Roll application code back to compatible reads and leave additive tables/optional fields in place. Do not delete tables or development data without separate review.
- Inspect dead-letter metadata and correlation IDs; never paste raw customer content, tokens or QR values into tickets.
- If encryption keys are lost, revoke the linked device and reset the session. Do not weaken encryption or guess keys.
