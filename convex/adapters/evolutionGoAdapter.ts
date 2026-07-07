/**
 * EvolutionGoAdapter — implements IWhatsAppAdapter for the Evolution Go provider.
 *
 * This is a thin wrapper around the existing `evolutionGoClient.ts` module,
 * conforming to the adapter interface so the rest of the codebase can use
 * providers interchangeably.
 */

import type {
  IWhatsAppAdapter,
  ConnectionArtifacts,
  ConnectionState,
  InstanceStatus,
  CreateInstanceOptions,
} from "./types";

import * as evoClient from "../evolutionGoClient"; 

export class EvolutionGoAdapter implements IWhatsAppAdapter {
  readonly providerId = "evolution-go" as const;

  // ── Instance Lifecycle ──

  async createInstance(
    instanceName: string,
    options?: CreateInstanceOptions
  ): Promise<ConnectionArtifacts> {
    return evoClient.createInstance(instanceName, {
      displayName: options?.displayName,
    });
  }

  async instanceExists(instanceName: string): Promise<boolean> {
    return evoClient.instanceExists(instanceName);
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await evoClient.deleteInstance(instanceName);
  }

  // ── Connection ──

  async connect(
    instanceName: string,
    options?: { webhookUrl?: string; subscribedEvents?: string[] }
  ): Promise<ConnectionArtifacts> {
    await evoClient.connectInstance(instanceName, {
      immediate: true,
      webhookUrl: options?.webhookUrl,
      subscribe: options?.subscribedEvents,
    });

    // After connect, poll for artifacts
    return evoClient.waitForConnectionArtifacts(instanceName, {
      attempts: 6,
      delayMs: 2000,
    });
  }

  async disconnect(instanceName: string): Promise<void> {
    await evoClient.disconnectInstance(instanceName);
  }

  async getStatus(instanceName: string): Promise<InstanceStatus> {
    const status = await evoClient.getInstanceStatus(instanceName);
    return {
      connected: status.connected,
      loggedIn: status.loggedIn,
      name: status.name,
      state: status.state as ConnectionState,
    };
  }

  async getConnectionState(instanceName: string): Promise<ConnectionState> {
    const state = await evoClient.getConnectionState(instanceName);
    return state as ConnectionState;
  }

  async waitForConnectionArtifacts(
    instanceName: string,
    options?: { attempts?: number; delayMs?: number }
  ): Promise<ConnectionArtifacts> {
    return evoClient.waitForConnectionArtifacts(instanceName, options);
  }

  // ── Messaging ──

  async sendText(instanceName: string, to: string, text: string): Promise<void> {
    await evoClient.sendText(instanceName, to, text);
  }

  // ── Pairing ──

  async requestPairingCode(
    instanceName: string,
    phone: string,
    options?: { subscribedEvents?: string[] }
  ): Promise<ConnectionArtifacts> {
    return evoClient.pairInstance(instanceName, phone, {
      subscribe: options?.subscribedEvents,
    });
  }
}
