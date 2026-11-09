# ADR 0001: preserve the stack; use Convex-native durable scheduling

Date: 2026-10-27. Status: **accepted for Phase 1 on 2026-10-27**.
Scope: Phase 1 foundation and later background work unless superseded by a new ADR.

**Implementation update, 2026-10-28:** the owner confirms no real sellers, the latest Evolution Go build is deployed, no worker exists, and approved starting Phase 1. This accepts the no-worker amendment. The original BullMQ design remains below as historical reasoning only.

## Accepted decision

1. Preserve the existing Next.js, React, TypeScript, Auth.js, Convex and Evolution Go stack.
2. Use Convex mutations, scheduled internal functions and crons. Do not add Redis, BullMQ or a separately managed worker.
3. Persist authenticated inbound events before acknowledgement, with tenant/session/generation deduplication, attempts, leases, retry deadlines and dead-letter state.
4. Recover abandoned event, deletion and disconnect work from a one-minute internal maintenance cron. External-provider actions schedule retry only after definite failure.
5. Keep legacy worker/scheduler implementations inactive rather than deleting them. The Phase 1 router and maintenance cron are the active exports.
6. Revisit queue infrastructure only with measured Convex limits or a new operational requirement.

## Consequences

- Removed scope: Redis, BullMQ workers, cross-system relay, worker credentials and worker health ownership.
- Added responsibility: explicit retry/backoff, leases, reconciliation and seller-visible dead letters for scheduled actions.
- Send safety is unchanged: unknown outbound outcomes must never be blindly replayed. Phase 1 has no application-originated sends.

## Historical proposal

The remainder records the superseded BullMQ proposal and the reasoning that led to the accepted amendment.

## Context

This is an existing Next.js/React/TypeScript/Auth.js/Convex application, not greenfield. The brief fixes Evolution Go and BullMQ, but source currently uses Convex scheduler/crons and directly calls the provider. Replacing the database/frontend would spend effort outside the recovery loop. Leaving both schedulers responsible for the same work would create duplicate sends.

## Decision

1. Retain the installed stack and existing frontend conventions. Keep Convex as the transactional source of truth and realtime read model. Keep Evolution Go; do not add an official-provider migration to this scope.
2. Add BullMQ with durable Redis and an always-on TypeScript worker after approval. Next.js handles seller UI/auth, not background queue execution. Evolution Go, Redis and workers need documented operational ownership and independently checked health.
3. Persist authenticated ingress in a tenant/session-scoped Convex inbox before acknowledging it. Commit normalized domain changes and an outbox record atomically. A relay claims bounded outbox batches, enqueues stable hashed job IDs, and records publication; retries retain the same logical identity.
4. Treat delivery from Convex to Redis and from Redis to workers as at-least-once. Each worker validates job schema/tenant, checks durable job receipts, and commits results idempotently. BullMQ deduplication alone is insufficient once jobs are removed or Redis is restored. Queue envelopes hold opaque IDs and correlation metadata, not personal content or credentials.
5. Expose only narrow authenticated worker HTTP endpoints calling internal functions; no public arbitrary mutation runner or trusted client-supplied tenant IDs. Separate webhook authentication, user identity and worker service identity. Enforce authorization on every read/write and linked resource, not only at page routing.
6. Use one outbound gateway for customer follow-ups and seller digests, with distinct purposes and quotas. Remove legacy public direct-send paths and independently scheduling cron paths during an approved cutover. Replay of old jobs must fail the new policy/version gate, not resurrect automation.

## Crash-window reasoning

| Failure | Recovery |
| --- | --- |
| Webhook before inbox commit | Return failure; provider retry uses the same event identity. No successful acknowledgement of data not stored. |
| Inbox committed, acknowledgement lost | Duplicate authentication/lookup returns existing receipt; no second domain effect. |
| Domain/outbox commit succeeds, Redis unavailable | Relay retries retained outbox record; seller sees backlog/degraded state. |
| Enqueue succeeds, publication mark lost | Relay may enqueue again; stable job key plus durable worker completion prevents duplicate effects. |
| Worker result commits, BullMQ completion lost | Redelivered job observes completion; no repeat mutation or send. |
| Provider accepts send, response or database write lost | Not solved by outbox alone. Persist `unknown`; never automatically resubmit. Reconcile under ADR 0002. |

Every queue has retry/backoff/timeout policy, terminal DLQ evidence and operator alerts. Authentication/schema failures are not transient. An expired lease only permits non-external work to be reclaimed; it is not proof an outbound send never occurred. Use fencing tokens and atomic quota/revision checks before the irreversible gateway call.

## Migration and rollback plan

Each schema change requires a versioned, resumable migration with cursor/checkpoints, bounded indexed batches, counts, dry-run/rehearsal results and a rollback/runbook. Do not merely edit `schema.ts` and assume existing documents satisfy it.

1. Identify the approved non-production target and whether live tenants/sessions exist. Obtain explicit consent for any production snapshot, pause, mutation or deployment. Preserve source data and a restorable snapshot before destructive migration.
2. Add a fail-closed phase/send policy and restrict unsafe entry points first. Record cancellation of legacy pending viewer/campaign/auto-send work with reason and policy version. Pausing live work is a separate approved operational action, not authorized by this ADR.
3. Expand schema additively; establish verified subject-to-business mappings. Quarantine ambiguous owners, duplicate identities and mixed-tenant references; never merge by display name or guess account ownership. Retain original evidence for review.
4. Backfill conversation/identity keys, message provenance and financial units using explicit source versions. Missing inbound/overdue/payment evidence stays unknown; do not manufacture provenance or convert legacy estimated recovery into confirmed recovery. Reconcile counts and totals against the snapshot.
5. Shadow-read/replay with fake or approved redacted events and no outbound effects; prove authorization, cancellation and deduplication. Cut one producer path over at a time. No dual sends and no blindly replaying history into follow-up creation.
6. Remove old schedulers/unsafe APIs only after verification. Rollback restores compatible reads and halts new dispatch; it never reenables old campaigns or resends submitted intents. Financial corrections are append-only. Rehearse restoration including deletion tombstones.

## Alternatives and consequences

- **Convex-only scheduling:** simpler infrastructure, but contradicts the fixed BullMQ decision. Not selected; no request to reopen that choice.
- **Rewrite to SQL/new frontend:** unnecessary scope, data migration risk and lost realtime/UI investment. Not selected.
- **Write DB then enqueue without outbox:** loses jobs on crashes. Not selected.
- **Run both old crons and new workers:** risks duplicate/stale outreach. Not selected.
- **Cost:** Redis, persistent workers, an authenticated bridge and reconciliation add operational complexity. This is the explicit cost of preserving Convex while adopting BullMQ. Keep module boundaries small, avoid additional brokers/services and defer dashboard polish rather than remove reliability work.

Before implementation, consult installed/version-current Convex auth/function guidance. The repository has no managed Convex AI guidance; consider `npx convex ai-files install` only in an approved implementation phase, not as an unreviewed discovery change.

## Proposed review amendment: no separately managed worker

**Status: accepted for Phase 1 on 2026-10-27.**

The clarification changes the operational constraint: there is no worker to reuse and the owner does not want unnecessary infrastructure. BullMQ still requires a worker consumer to process jobs, although that consumer can share a suitable existing long-running Node service/host. A new server is not inherently required. A queue producer alone does not execute jobs.

**Recommendation:** retain Convex-native scheduled functions and crons, already present in this application, instead of introducing BullMQ/Redis. Convex's managed execution removes the need for a separately operated queue worker; it does not remove background execution or reliability work.

- A Convex mutation commits domain changes and schedules the internal function atomically. Keep durable task/inbox records and internal scheduled mutations/actions; no cross-system outbox relay is needed solely for Redis publication.
- Keep explicit attempt counters, retry deadlines, maximum attempts, backoff/jitter, leases where required, error categories and terminal dead-letter records. Use an internal reconciliation cron for stalled tasks and surface failure state to the seller. The original queue topology becomes logical task kinds, not multiple Redis queues.
- Scheduled mutations have Convex's transaction/retry guarantees. Scheduled actions can perform external effects and are not automatically retried. Application recovery must inspect the durable send ledger; an unknown provider outcome remains blocked, never blindly resent. ADR 0002 remains unchanged in substance.
- Preserve tenant authorization, explicit group opt-in, no-send phase gates, conversation-reply cancellation, atomic quotas, per-business serialization, warm-up, kill switch, provider contract tests and auditable attribution. Using the existing scheduler does not make the legacy unsafe jobs acceptable.
- Test scheduled execution, retry exhaustion/dead-letter handling, cancellation races, concurrent quota reservation and unknown sends with fake providers. Add an approved non-production scheduling/recovery qualification before real traffic; do not claim fake tests prove hosted crash recovery.
- Scope displaced: BullMQ dependency, Redis operations, separately managed queue workers and cross-system relay/reconciliation. Tradeoff: implement application-level retry/dead-letter and inspection behavior rather than rely on BullMQ's queue facilities; remain within Convex execution/resource constraints. No extra feature scope is added.

This is justified by the existing Convex stack and the owner's revised infrastructure preference, not by claiming BullMQ can run without a worker. No real sellers reduces rollout coordination, but does not authorize deletion of development data/sessions. Upon approval, rewrite the conditional architecture/topology and migration plan to the single Convex path before implementation. Otherwise keep BullMQ and explicitly plan its worker runtime.

Primary documentation checked on 2026-10-27: BullMQ Workers (`https://docs.bullmq.io/guide/workers`), BullMQ Concurrency (`https://docs.bullmq.io/guide/workers/concurrency`), and Convex Scheduled Functions (`https://docs.convex.dev/scheduling/scheduled-functions`). These describe processing and scheduling guarantees, not exactly-once WhatsApp delivery.
