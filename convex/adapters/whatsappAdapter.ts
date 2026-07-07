/**
 * WhatsApp Adapter — re-exports types and provides the adapter factory.
 *
 * All types and the IWhatsAppAdapter interface are defined in ./types.ts
 * to avoid circular dependencies between this file and provider implementations.
 */

import type {
  ConnectionState,
  ConnectionArtifacts,
  InstanceStatus,
  SendMessageOptions,
  CreateInstanceOptions,
  IWhatsAppAdapter,
  WhatsAppMode,
} from "./types";

import { EvolutionGoAdapter } from "./evolutionGoAdapter";

// Re-export all types and the interface from the canonical source
export type {
  ConnectionState,
  ConnectionArtifacts,
  InstanceStatus,
  SendMessageOptions,
  CreateInstanceOptions,
  IWhatsAppAdapter,
};

/**
 * Returns the appropriate adapter for the given WhatsApp mode.
 * Currently only Evolution Go is implemented. Cloud API adapter
 * will be added in a future batch.
 */
export function getAdapter(mode: WhatsAppMode): IWhatsAppAdapter {
  switch (mode) {
    case "unofficial":
      return new EvolutionGoAdapter();
    case "official":
      throw new Error("Cloud API adapter is not yet implemented. Coming soon.");
    default:
      throw new Error(`Unknown WhatsApp mode: ${mode}`);
  }
}
