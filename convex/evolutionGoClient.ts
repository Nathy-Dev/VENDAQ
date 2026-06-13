/**
 * Evolution Go REST client.
 * All outbound WhatsApp messages go through sendText(), which enforces
 * the PRD-required 3-12 second randomized delay before every send.
 *
 * Required Convex environment variables:
 *   EVOLUTION_GO_URL     - e.g. https://your-vps.hostinger.com:8080
 *   EVOLUTION_GO_API_KEY - global API key from Evolution Go config
 *   CONVEX_SITE_URL      - public Convex site URL (already set)
 */

function getEvolutionConfig(): { url: string; apiKey: string } {
  const url = process.env.EVOLUTION_GO_URL || "";
  const apiKey = process.env.EVOLUTION_GO_API_KEY || "";
  if (!url || !apiKey) {
    throw new Error(
      "EVOLUTION_GO_URL and EVOLUTION_GO_API_KEY must be set in Convex environment variables."
    );
  }
  return { url: url.replace(/\/$/, ""), apiKey };
}

async function evoFetch(path: string, method: string, body?: unknown): Promise<unknown> {
  const { url, apiKey } = getEvolutionConfig();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Evolution Go ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

/** Creates a new WhatsApp instance on Evolution Go. */
export async function createInstance(instanceName: string): Promise<void> {
  await evoFetch("/instance/create", "POST", {
    instanceName,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
  });
}

/**
 * Sets the webhook URL for an instance.
 * Called immediately after createInstance so all events flow to Convex.
 */
export async function setWebhook(instanceName: string, webhookUrl: string): Promise<void> {
  await evoFetch(`/webhook/set/${instanceName}`, "PUT", {
    url: webhookUrl,
    webhook_by_events: false,
    webhook_base64: false,
    events: [
      "QRCODE_UPDATED",
      "MESSAGES_UPSERT",
      "CONNECTION_UPDATE",
      "SEND_MESSAGE",
    ],
  });
}

/** Returns the current QR code string for an instance, or null if not pending. */
export async function getQR(instanceName: string): Promise<string | null> {
  try {
    const data = await evoFetch(`/instance/connect/${instanceName}`, "GET") as { base64?: string; code?: string };
    return data?.base64 || data?.code || null;
  } catch {
    return null;
  }
}

/** Returns the connection state: "open" | "close" | "connecting" */
export async function getConnectionState(instanceName: string): Promise<string> {
  const data = await evoFetch(`/instance/connectionState/${instanceName}`, "GET") as {
    instance?: { state?: string };
    state?: string;
  };
  return data?.instance?.state || data?.state || "close";
}

/**
 * Sends a text message.
 * Enforces a 3-12 second random delay before the actual send (PRD requirement).
 */
export async function sendText(instanceName: string, to: string, text: string): Promise<void> {
  const delayMs = 3000 + Math.random() * 9000;
  await new Promise((r) => setTimeout(r, delayMs));
  await evoFetch(`/message/sendText/${instanceName}`, "POST", {
    number: to,
    text,
  });
}

/** Deletes an instance from Evolution Go. */
export async function deleteInstance(instanceName: string): Promise<void> {
  await evoFetch(`/instance/delete/${instanceName}`, "DELETE");
}
