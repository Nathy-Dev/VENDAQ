/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { encryptSecret, sha256 } from "../convex/lib/crypto";

// Include generated JS modules so convex-test discovers the real function root.
const modules = import.meta.glob("../convex/**/*.*s");
export const createHarness = () => convexTest(schema, modules);
export type Harness = ReturnType<typeof createHarness>;

export async function tenant(harness: Harness, label = "seller-one") {
  const owner = harness.withIdentity({ subject: `google:${label}`, issuer: "https://auth.example.test" });
  const businessId = await owner.mutation(api.foundation.createBusiness, { name: label });
  const token = `synthetic-token-${label}`;
  const tokenHash = await sha256(token);
  const tokenCiphertext = await encryptSecret(token, `business:${businessId}:session-token`);
  const instanceId = `synthetic-instance-${label}`;
  const sessionId = await harness.run((ctx) => ctx.db.insert("whatsappSessions", {
    businessId, instanceName: `pipelixr-${businessId}`, providerInstanceId: instanceId,
    generation: 1, state: "connected", tokenHash, tokenCiphertext,
    disclosureVersion: "phase-1-2026-10-27", consentAt: Date.now() - 1000,
    createdAt: Date.now(), updatedAt: Date.now(), nextHealthAt: Date.now() + 86400000,
  }));
  return { owner, businessId, token, tokenHash, tokenCiphertext, instanceId, sessionId };
}

export function message(source: Awaited<ReturnType<typeof tenant>>, options: {
  id?: string; chat?: string; content?: Record<string, unknown>; fromMe?: boolean; at?: number; name?: string;
} = {}) {
  return {
    event: options.fromMe ? "SendMessage" : "Message", instanceId: source.instanceId, instanceToken: source.token,
    data: {
      Info: { ID: options.id ?? "message-1", Chat: options.chat ?? "2348000000001@s.whatsapp.net", IsFromMe: options.fromMe ?? false, IsGroup: false, PushName: options.name ?? "Synthetic Buyer", Timestamp: new Date(options.at ?? Date.now()).toISOString() },
      Message: options.content ?? { conversation: "How much for this one?" },
    },
  };
}

export function webhook(harness: Harness, body: unknown) {
  return harness.fetch("/api/webhook/evolution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function drain(harness: Harness) {
  await harness.finishAllScheduledFunctions(() => vi.runAllTimers());
}
