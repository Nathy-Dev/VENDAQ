/** WhatsApp connection mode as defined in the PRD and schema. */
export type WhatsAppMode = "official" | "unofficial";

// ── Adapter Types ──

export type ConnectionState = "open" | "close" | "connecting";

export type ConnectionArtifacts = {
  qrCode: string | null;
  pairingCode: string | null;
};

export type InstanceStatus = {
  connected: boolean;
  loggedIn: boolean;
  name: string;
  state: ConnectionState;
};

export type SendMessageOptions = {
  /** Recipient phone number (international format) or Group JID */
  to: string;
  /** Text content of the message */
  text: string;
  /** Optional media URL to attach */
  mediaUrl?: string;
  /** Optional media type */
  mediaType?: "image" | "video" | "audio" | "document";
};

export type CreateInstanceOptions = {
  displayName?: string;
  webhookUrl?: string;
  subscribedEvents?: string[];
};

// ── Interface ──

/**
 * IWhatsAppAdapter — PRD-mandated abstraction layer for WhatsApp providers.
 *
 * This interface decouples Pipelixr's business logic from any specific
 * WhatsApp integration (Evolution Go, Cloud API, or future providers).
 *
 * To add a new provider:
 *   1. Implement this interface.
 *   2. Register it in the adapter factory (getAdapter).
 *   3. The rest of the codebase stays untouched.
 */
export interface IWhatsAppAdapter {
  /** Unique adapter identifier (e.g., "evolution-go", "cloud-api") */
  readonly providerId: string;

  // ── Instance Lifecycle ──

  /** Creates a new WhatsApp instance/session. */
  createInstance(instanceName: string, options?: CreateInstanceOptions): Promise<ConnectionArtifacts>;

  /** Checks if a named instance exists on the provider. */
  instanceExists(instanceName: string): Promise<boolean>;

  /** Deletes an instance from the provider. */
  deleteInstance(instanceName: string): Promise<void>;

  // ── Connection ──

  /** Initiates a connection (triggers QR code generation). */
  connect(instanceName: string, options?: { webhookUrl?: string; subscribedEvents?: string[] }): Promise<ConnectionArtifacts>;

  /** Disconnects the instance (keeps instance, drops WS). */
  disconnect(instanceName: string): Promise<void>;

  /** Returns current connection status. */
  getStatus(instanceName: string): Promise<InstanceStatus>;

  /** Returns current connection state string. */
  getConnectionState(instanceName: string): Promise<ConnectionState>;

  /** Polls for QR/pairing code artifacts. */
  waitForConnectionArtifacts(instanceName: string, options?: { attempts?: number; delayMs?: number }): Promise<ConnectionArtifacts>;

  // ── Messaging ──

  /** Sends a text message with PRD-mandated randomized delay (3-12s). */
  sendText(instanceName: string, to: string, text: string): Promise<void>;

  // ── Pairing ──

  /** Requests a phone-based pairing code (link by phone number). */
  requestPairingCode(instanceName: string, phone: string, options?: { subscribedEvents?: string[] }): Promise<ConnectionArtifacts>;
}
