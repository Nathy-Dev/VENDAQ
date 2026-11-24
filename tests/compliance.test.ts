import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { createHarness, drain, message, tenant, webhook } from "./harness";

describe("compliance controls", () => {
  it("records immutable versioned legal acceptance and isolates it by identity", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "legal-owner");
    const other = await tenant(harness, "legal-other");
    expect((await source.owner.query(api.compliance.legalStatus, {})).ready).toBe(false);
    await source.owner.mutation(api.compliance.acceptLegal, { documents: ["terms", "privacy", "acceptable_use", "dpa"], method: "account_gate" });
    await source.owner.mutation(api.compliance.acceptLegal, { documents: ["terms", "privacy", "acceptable_use", "dpa"], method: "account_gate" });
    expect((await source.owner.query(api.compliance.legalStatus, {})).ready).toBe(true);
    expect((await other.owner.query(api.compliance.legalStatus, {})).ready).toBe(false);
    expect(await harness.run((ctx) => ctx.db.query("legalAcceptances").withIndex("by_business", (q) => q.eq("businessId", source.businessId)).collect())).toHaveLength(4);
  });

  it("keeps service replies separate from marketing and requires evidence", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "consent-owner");
    await webhook(harness, message(source, { id: "service-message", content: { conversation: "Do you have this in blue?" } }));
    await drain(harness);
    const [contact] = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    expect(await source.owner.query(api.compliance.customerCommunication, { businessId: source.businessId, customerId: contact.customerId })).toMatchObject({ state: "service_only", marketingConsentAt: null });
    await expect(source.owner.mutation(api.compliance.recordCustomerCommunication, { businessId: source.businessId, customerId: contact.customerId, decision: "marketing_granted", evidence: "short" })).rejects.toThrow();
    await source.owner.mutation(api.compliance.recordCustomerCommunication, { businessId: source.businessId, customerId: contact.customerId, decision: "marketing_granted", evidence: "Customer ticked the offers checkbox on 23 November 2026." });
    expect(await source.owner.query(api.compliance.customerCommunication, { businessId: source.businessId, customerId: contact.customerId })).toMatchObject({ state: "marketing_opted_in" });
  });

  it("treats STOP as an immediate withdrawal and never schedules an assistant reply", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "stop-owner");
    await source.owner.mutation(api.businessProfile.save, { businessId: source.businessId, systemPrompt: "You represent Stop Owner, a Nigerian retail business. Answer only from verified business facts and never invent prices, stock, delivery details, discounts, payment information, or policies. Ask a short question when required information is missing.", customerAutoReplyEnabled: true, groupAutoReplyEnabled: false });
    await webhook(harness, message(source, { id: "stop-message", content: { conversation: "STOP" } }));
    await drain(harness);
    const [contact] = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    expect(await source.owner.query(api.compliance.customerCommunication, { businessId: source.businessId, customerId: contact.customerId })).toMatchObject({ state: "opted_out" });
    expect(await harness.run((ctx) => ctx.db.query("assistantDispatches").collect())).toHaveLength(0);
  });

  it("prevents cross-tenant consent, export, and deletion access", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "privacy-owner");
    const other = await tenant(harness, "privacy-other");
    await webhook(harness, message(source, { id: "privacy-message" }));
    await drain(harness);
    const [contact] = await source.owner.query(api.foundation.customers, { businessId: source.businessId });
    await expect(other.owner.query(api.compliance.customerCommunication, { businessId: source.businessId, customerId: contact.customerId })).rejects.toThrow();
    await expect(other.owner.query(api.compliance.exportWorkspace, { businessId: source.businessId })).rejects.toThrow();
    await expect(other.owner.action(api.compliance.requestAccountDeletion, { businessId: source.businessId, confirmation: "privacy-owner" })).rejects.toThrow();
  });

  it("exports the tenant workspace and records privacy requests", async () => {
    const harness = createHarness();
    const source = await tenant(harness, "export-owner");
    await webhook(harness, message(source, { id: "export-message", content: { conversation: "I need the green one" } }));
    await drain(harness);
    const exported = await source.owner.query(api.compliance.exportWorkspace, { businessId: source.businessId });
    expect(exported.business.name).toBe("export-owner");
    expect(exported.customers).toHaveLength(1);
    expect(exported.messages[0].content).toBe("I need the green one");
    await source.owner.mutation(api.compliance.createPrivacyRequest, { businessId: source.businessId, requestType: "correction", details: "Correct the business contact record." });
    expect(await source.owner.query(api.compliance.privacyRequests, { businessId: source.businessId })).toEqual([expect.objectContaining({ requestType: "correction", status: "open" })]);
  });
});
