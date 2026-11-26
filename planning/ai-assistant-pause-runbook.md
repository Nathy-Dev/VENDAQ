# AI Assistant pause rollout

The master switch lives in **Settings → AI Assistant**. Off keeps the WhatsApp connection and manual inbox sync. Text, captions, and attachment notices remain available; open attachments and reply in WhatsApp. Exact consent keywords still apply. Customer and group auto-reply preferences are saved separately and will apply to eligible new messages if AI is turned back on. The optional, seller-initiated business playbook tools are separate from customer-message processing.

## Compatibility

- Deploy the Convex backend before the Next.js frontend that calls the new switch. Verify both target the same project and environment.
- During rollout, a cached client can still pause AI by saving both auto-reply scopes off. Its saves cannot turn AI back on. Refresh to use the new master switch independently of the reply scopes.
- The schema changes are additive. Do not backfill processing epochs. Existing explicitly enabled workspaces stay enabled; unmarked historical messages and queued AI work fail closed. Existing inbox records and completed results are not deleted.
- The enable-time cutoff treats messages at or before the transition as manual-only. Queued work from a revoked epoch stays revoked even if AI is immediately turned back on.
- Requests already sent to a provider cannot be recalled. The backend rechecks authorization before later provider calls and rejects analysis results returned after revocation. A WhatsApp send already submitted may still be delivered.

## Smoke test and rollback

1. On a non-production deployment with a disposable WhatsApp account, save both reply scopes and enable a test group. Turn AI Assistant off.
2. Send direct and group text, an image and a voice note, then reply manually. Confirm the inbox reflects the messages and attachment notices, without labels, new suggestions, media downloads, AI requests, or assistant sends.
3. Turn AI back on. Replay an off-period message and send a new eligible one. Confirm only the new message can be processed. Confirm an existing rescue tied to a revoked message cannot send and directs the seller to WhatsApp.
4. After explicit production approval, deploy backend first, then frontend. Perform the same smoke test with an approved test workspace, without real customer messages.
5. If rollout fails, keep the backend processing guard in place while fixing the frontend or rolling it back. Do not redeploy code that ignores the pause state while WhatsApp is connected. If the guard cannot be kept, disconnect the affected test or production sessions before any backend rollback. Leave the optional schema fields in place.
