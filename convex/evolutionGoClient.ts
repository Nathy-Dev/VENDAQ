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

export function getEvolutionConfig(): { url: string; apiKey: string } {
  const url = process.env.EVOLUTION_GO_URL || "";
  const apiKey = process.env.EVOLUTION_GO_API_KEY || "";
  if (!url || !apiKey) {
    throw new Error(
      "EVOLUTION_GO_URL and EVOLUTION_GO_API_KEY must be set in Convex environment variables."
    );
  }
  return { url: url.replace(/\/$/, ""), apiKey };
}

export async function evoFetch(path: string, method: string, body?: unknown): Promise<unknown> {
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

/** Returns true if the named instance already exists on Evolution Go.
 * Handles both flat ({ instanceName }) and nested ({ instance: { instanceName } }) response shapes.
 */
export async function instanceExists(instanceName: string): Promise<boolean> {
  try {
    const rawData = await evoFetch("/instance/all", "GET") as any;
    
    // Sometimes it's an array, sometimes it's an object like { instances: [...] } or a record of instances
    let dataArray: Array<Record<string, unknown>> = [];
    if (Array.isArray(rawData)) {
      dataArray = rawData;
    } else if (rawData && typeof rawData === "object") {
      if (Array.isArray(rawData.instances)) {
        dataArray = rawData.instances;
      } else if (Array.isArray(rawData.data)) {
        dataArray = rawData.data;
      } else {
        // If it's a map { [name]: {...} }
        const values = Object.values(rawData);
        if (values.length > 0 && typeof values[0] === "object") {
          dataArray = values as Array<Record<string, unknown>>;
        }
      }
    }
    
    if (dataArray.length === 0) {
      // It might genuinely be empty, or we failed to parse the shape. Let's assume it doesn't exist for now.
      return false;
    }
    
    const exists = dataArray.some((d) => {
      const flatName = (d?.instanceName || d?.name) as string | undefined;
      const nestedName = (d?.instance as any)?.instanceName || (d?.instance as any)?.name as string | undefined;
      return flatName === instanceName || nestedName === instanceName;
    });

    if (!exists) {
      console.warn(`[instanceExists] Instance ${instanceName} not found. Data sample:`, dataArray.slice(0, 2));
    }
    return exists;
  } catch (error) {
    console.error("[instanceExists] Error:", error);
    return false;
  }
}

/** Deletes an instance, ignoring errors (e.g. if it doesn't exist). */
export async function deleteInstanceSilently(instanceName: string): Promise<void> {
  try {
    await evoFetch(`/instance/delete/${instanceName}`, "DELETE");
  } catch {
    // ignore
  }
}

/** Creates a new WhatsApp instance on Evolution Go and returns the initial QR base64 if available. */
export async function createInstance(instanceName: string, webhookUrl: string): Promise<string | null> {
  const { apiKey } = getEvolutionConfig();
  const res = await evoFetch("/instance/create", "POST", {
    name: instanceName, // Evolution Go (Go port) uses 'name'
    instanceName: instanceName, // Send both just in case
    token: apiKey, // Provide token as required by the API
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
    webhook: webhookUrl, // Sometimes it accepts a simple string
    webhook_by_events: false,
    webhook_base64: false,
    events: [
      "QRCODE",
      "QRCODE_UPDATED",
      "MESSAGE",
      "MESSAGES_UPSERT",
      "CONNECTION",
      "CONNECTION_UPDATE",
      "SEND_MESSAGE",
    ],
  }) as any;

  // Many Evolution API versions return the QR in the creation response
  return res?.qrcode?.base64 || res?.qrcode?.code || res?.base64 || res?.code || res?.instance?.qrcode || null;
}

/**
 * Sets the webhook URL for an instance.
 * Called immediately after createInstance so all events flow to Convex.
 */
export async function setWebhook(instanceName: string, webhookUrl: string): Promise<void> {
  const payload = {
    webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: [
          "QRCODE",
          "QRCODE_UPDATED",
          "MESSAGE",
          "MESSAGES_UPSERT",
          "CONNECTION",
          "CONNECTION_UPDATE",
          "SEND_MESSAGE",
        ],
    }
  };
  // Try the v2 endpoint
  try {
      await evoFetch(`/webhook/instance/${instanceName}`, "POST", payload);
      return;
  } catch (e: any) {
      if (!e.message.includes("404")) throw e;
  }
  
  // Try the v1.x / Go port alternative endpoint
  try {
      await evoFetch(`/webhook/set/${instanceName}`, "POST", payload);
  } catch (e: any) {
      // Ignore 404s if the webhook was possibly set during creation
      if (!e.message.includes("404")) throw e;
      console.warn(`[setWebhook] endpoints returned 404 for ${instanceName}. Ignoring.`);
  }
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
