// First-launch feature gates. Later-phase code stays in the repository but is
// unreachable until a deliberate rollout changes these constants.
export const STATUS_TO_CASH_ENABLED = false;
export const BUSINESS_SYSTEM_PROMPT_MIN_LENGTH = 120;
export const BUSINESS_SYSTEM_PROMPT_MAX_LENGTH = 8_000;

export function assistantReplyDelayMs(replyLength: number, seed: string): number {
  const minimum = 3_000;
  const maximum = 15_000;
  const estimated = 1_500 + Math.max(0, Math.min(replyLength, 1_000)) * 45;
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const jitter = (hash >>> 0) % 2_001;
  return Math.min(maximum, Math.max(minimum, estimated + jitter));
}
