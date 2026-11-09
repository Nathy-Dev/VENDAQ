import { ConvexError } from "convex/values";

// Normalize only the address casing; do not guess provider-specific aliases.
export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ConvexError({ code: "INVALID_CREDENTIALS" });
  }
  return email;
}

export function validatePassword(value: string, registering: boolean): void {
  // bcrypt ignores bytes after 72. Reject them instead of silently truncating.
  const length = new TextEncoder().encode(value).byteLength;
  if (length > 72 || value.length < (registering ? 12 : 1)) {
    throw new ConvexError({ code: "INVALID_CREDENTIALS" });
  }
}
