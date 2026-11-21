import { describe, expect, it } from "vitest";
import { customSafeguardsReady, groupSafeguardSelection } from "../src/lib/groupSafeguards";

describe("group safeguard selection", () => {
  it("opens a local draft instead of saving when custom safeguards are selected", () => {
    expect(groupSafeguardSelection("custom", "", false)).toEqual({
      kind: "draft",
      instructions: "",
      allowPrivateHandoff: false,
    });
  });

  it("saves non-custom modes immediately", () => {
    expect(groupSafeguardSelection("common_questions", "Existing custom rule", true)).toEqual({
      kind: "save",
      mode: "common_questions",
      customInstructions: "Existing custom rule",
      allowPrivateHandoff: true,
    });
  });

  it("requires the same ten-character minimum as the backend", () => {
    expect(customSafeguardsReady("Too short")).toBe(false);
    expect(customSafeguardsReady("Only answer delivery questions.")).toBe(true);
  });
});
