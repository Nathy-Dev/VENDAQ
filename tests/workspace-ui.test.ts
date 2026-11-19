import { describe, expect, it } from "vitest";
import { launchOnboardingStage } from "../src/lib/workspace-ui";

describe("launch onboarding progression", () => {
  it("does not reveal business AI before WhatsApp is connected", () => {
    expect(launchOnboardingStage({ state: "pending", hasBusinessSystemPrompt: false })).toBe("connection");
    expect(launchOnboardingStage({ state: "error", hasBusinessSystemPrompt: true })).toBe("connection");
  });

  it("reveals each next step only after the current requirement is complete", () => {
    expect(launchOnboardingStage({ state: "connected", hasBusinessSystemPrompt: false })).toBe("business_ai");
    expect(launchOnboardingStage({ state: "connected", hasBusinessSystemPrompt: true })).toBe("groups");
  });
});
