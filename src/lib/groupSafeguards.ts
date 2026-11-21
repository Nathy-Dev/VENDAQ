export type GovernanceMode = "watch" | "suggest" | "mentions" | "common_questions" | "custom";

export const MIN_CUSTOM_INSTRUCTION_LENGTH = 10;

export function groupSafeguardSelection(mode: GovernanceMode, customInstructions: string, allowPrivateHandoff: boolean) {
  if (mode === "custom") {
    return { kind: "draft" as const, instructions: customInstructions, allowPrivateHandoff };
  }
  return { kind: "save" as const, mode, customInstructions, allowPrivateHandoff };
}

export function customSafeguardsReady(customInstructions: string): boolean {
  return customInstructions.trim().length >= MIN_CUSTOM_INSTRUCTION_LENGTH;
}
