import type { Doc } from "../_generated/dataModel";

export type GroupGovernanceMode = "watch" | "suggest" | "mentions" | "common_questions" | "custom";

export function groupGovernanceMode(group: Doc<"managedGroups">): GroupGovernanceMode {
  return group.governanceMode ?? ((group.mentionOnly ?? true) ? "mentions" : "custom");
}

export function groupMayAutoReply(group: Doc<"managedGroups">, interaction: Doc<"interactions">): boolean {
  if (!group.isEnabled) return false;
  const mode = groupGovernanceMode(group);
  if (mode === "watch" || mode === "suggest") return false;
  if (mode === "mentions") return interaction.wasMentioned ?? false;
  if (mode === "common_questions") return (interaction.wasMentioned ?? false) || interaction.classifierLabel === "inquiry";
  return !(group.mentionOnly ?? true) || (interaction.wasMentioned ?? false);
}
