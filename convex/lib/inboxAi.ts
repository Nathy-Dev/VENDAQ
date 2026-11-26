import type { Doc } from "../_generated/dataModel";

type AiEnabledBusiness = Doc<"businesses"> & { foundationVersion: 1; aiEnabled: true };

export function isAiAssistantEnabled(business: Doc<"businesses"> | null): business is AiEnabledBusiness {
  return business?.foundationVersion === 1 && business.aiEnabled === true;
}

export function aiAssistantPatch(business: Doc<"businesses">, enabled: boolean, now: number) {
  return {
    aiEnabled: enabled,
    ...(isAiAssistantEnabled(business) !== enabled ? {
      aiProcessingEpoch: (business.aiProcessingEpoch ?? 0) + 1,
      ...(enabled ? { aiProcessingEnabledAt: now } : {}),
    } : {}),
  };
}

export function activeMessageAiEpoch(business: Doc<"businesses"> | null, timestamp: number): number | null {
  if (!isAiAssistantEnabled(business)) return null;
  if (business.aiProcessingEnabledAt !== undefined && timestamp <= business.aiProcessingEnabledAt) return null;
  return business.aiProcessingEpoch ?? 0;
}

export function canProcessInboxMessage(
  business: Doc<"businesses"> | null,
  message: { timestamp: number; aiProcessingEpoch?: number | null },
): business is AiEnabledBusiness {
  const epoch = activeMessageAiEpoch(business, message.timestamp);
  return epoch !== null && message.aiProcessingEpoch === epoch;
}
