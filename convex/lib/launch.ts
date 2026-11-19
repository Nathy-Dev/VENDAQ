// First-launch feature gates. Later-phase code stays in the repository but is
// unreachable until a deliberate rollout changes these constants.
export const STATUS_TO_CASH_ENABLED = false;
export const ASSISTANT_REPLY_DELAY_MS = 5_000;
export const BUSINESS_SYSTEM_PROMPT_MIN_LENGTH = 120;
export const BUSINESS_SYSTEM_PROMPT_MAX_LENGTH = 8_000;
