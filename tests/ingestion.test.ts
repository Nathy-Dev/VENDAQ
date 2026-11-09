import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { createHarness, drain, message, tenant, webhook } from "./harness";

describe("authenticated WhatsApp ingestion", () => {
  it("commits before acknowledgement and collapses 100 duplicate deliveries", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    const responses = await Promise.all(Array.from({ length: 100 }, () => webhook(harness, message(source))));
    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(await harness.run((ctx) => ctx.db.query("inboundEvents").collect())).toHaveLength(1);
    expect(await source.owner.query(api.foundation.customers, { businessId: source.businessId })).toHaveLength(0);
    await drain(harness);
    const contacts = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    expect(contacts).toHaveLength(1);
    const messages = await source.owner.query(api.foundation.messages, { businessId: source.businessId, customerId: contacts[0].customerId });
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("How much for this one?");
    const events = await harness.run((ctx) => ctx.db.query("inboundEvents").collect());
    expect(events[0].state).toBe("processed");
    expect(events[0].payload).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(source.token);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("2348000000001");
  });

  it("isolates identical message IDs across tenants and rejects mixed resource IDs", async () => {
    const harness = createHarness();
    const first = await tenant(harness);
    const second = await tenant(harness, "seller-two");
    await webhook(harness, message(first));
    await webhook(harness, message(second));
    await drain(harness);
    const contacts = await second.owner.query(api.foundation.customers, { businessId: second.businessId });
    await expect(first.owner.query(api.foundation.customers, { businessId: second.businessId })).rejects.toThrow("NOT_FOUND");
    await expect(first.owner.query(api.foundation.messages, { businessId: first.businessId, customerId: contacts[0].customerId })).rejects.toThrow("NOT_FOUND");
    await expect(first.owner.mutation(api.foundation.deleteCustomer, { businessId: first.businessId, customerId: contacts[0].customerId })).rejects.toThrow("NOT_FOUND");
    await expect(harness.query(api.foundation.workspace, {})).rejects.toThrow("UNAUTHENTICATED");
    await expect(harness.withIdentity({ subject: "google:seller-one", issuer: "https://attacker.test" }).query(api.foundation.workspace, {})).rejects.toThrow("UNAUTHENTICATED");
    expect(await harness.run((ctx) => ctx.db.query("customers").collect())).toHaveLength(2);
    const workspace = await first.owner.query(api.foundation.workspace, {});
    expect(JSON.stringify(workspace)).not.toMatch(/token|Ciphertext|instanceId|ownerId/);
  });

  it("requires the exact instance binding and token, never a display-name fallback", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    expect((await webhook(harness, { ...message(source), instanceToken: "wrong" })).status).toBe(401);
    expect((await webhook(harness, { ...message(source), instanceId: "unknown" })).status).toBe(401);
    expect((await webhook(harness, { ...message(source), instanceId: undefined, instance: source.instanceId })).status).toBe(401);
    expect(await harness.run((ctx) => ctx.db.query("inboundEvents").collect())).toHaveLength(0);
  });

  it("stores casual and non-text messages, cancels either party's pending tasks, and keeps monotonic clocks", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source));
    await drain(harness);
    const [contact] = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    const initialTime = Date.now();
    for (const [index, content] of [{ conversation: "ok" }, { audioMessage: { url: "https://private-media.test" } }, { imageMessage: { caption: "payment proof" } }, { conversation: "Thank you" }].entries()) {
      const taskId = await harness.run((ctx) => ctx.db.insert("followUpTasks", { businessId: source.businessId, customerId: contact.customerId, reason: "buying_signal", status: "pending", dueAt: Date.now() + 60000, createdAt: initialTime - 1 }));
      await webhook(harness, message(source, { id: `reply-${index}`, fromMe: index === 3, content, at: initialTime + index }));
      await drain(harness);
      expect((await harness.run((ctx) => ctx.db.get(taskId)))?.status).toBe("cancelled");
    }
    await webhook(harness, message(source, { id: "older", at: initialTime - 500 }));
    await drain(harness);
    const customer = await harness.run((ctx) => ctx.db.get(contact.customerId));
    expect(customer?.lastInteraction).toBe(initialTime + 3);
    expect(customer?.lastOutboundAt).toBe(initialTime + 3);
    const stored = await source.owner.query(api.foundation.messages, { businessId: source.businessId, customerId: contact.customerId });
    expect(stored.filter((entry) => entry.manualReview)).toHaveLength(2);
    expect(JSON.stringify(stored)).not.toContain("private-media");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not merge opaque LIDs with phone identities or create tasks from groups/Status views", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    await webhook(harness, message(source, { chat: "12345@lid" }));
    await webhook(harness, message(source, { chat: "12345@s.whatsapp.net" }));
    await webhook(harness, message(source, { chat: "12345@g.us" }));
    await webhook(harness, { event: "Receipt", instanceId: source.instanceId, instanceToken: source.token, state: "Read", data: { Chat: "status@broadcast", Sender: "56789@lid", MessageIDs: ["status-1", "status-2"], Timestamp: new Date().toISOString() } });
    await drain(harness);
    expect(await harness.run((ctx) => ctx.db.query("customers").collect())).toHaveLength(2);
    const observations = await harness.run((ctx) => ctx.db.query("statusObservations").collect());
    expect(observations).toHaveLength(2);
    expect(JSON.stringify(observations)).not.toContain("56789@lid");
    const tasks = await harness.run((ctx) => ctx.db.query("followUpTasks").collect());
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.reason === "buying_signal" && task.triggerInteractionId !== undefined)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds payloads and quarantines authenticated malformed events without raw content", async () => {
    const harness = createHarness();
    const source = await tenant(harness);
    expect((await harness.fetch("/api/webhook/evolution", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status).toBe(400);
    expect((await webhook(harness, { padding: "x".repeat(262144) })).status).toBe(413);
    const malformed = message(source);
    malformed.data.Info.Timestamp = "invalid-private-timestamp";
    expect((await webhook(harness, malformed)).status).toBe(202);
    const [event] = await harness.run((ctx) => ctx.db.query("inboundEvents").collect());
    expect(event.state).toBe("dead_letter");
    expect(event.errorCode).toBe("INVALID_TIMESTAMP");
    expect(event.payload).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("invalid-private-timestamp");
    expect((await harness.fetch("/api/worker", { method: "POST" })).status).toBe(410);
  });
});
