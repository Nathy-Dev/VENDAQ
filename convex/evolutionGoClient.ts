/**
 * Evolution Go REST client.
 * All outbound WhatsApp messages go through sendText(), which enforces
 * the PRD-required 3-12 second randomized delay before every send.
 *
 * Required Convex environment variables:
 *   EVOLUTION_GO_URL     - e.g. https://your-vps.hostinger.com:8080
 *   EVOLUTION_GO_API_KEY - global API key from Evolution Go config
 *   CONVEX_SITE_URL      - public Convex site URL (preferred)
 *   NEXT_PUBLIC_CONVEX_SITE_URL - fallback for local/dev setups
 */

type ConnectionArtifacts = {
  qrCode: string | null;
  pairingCode: string | null;
};

function parseConnectionArtifacts(rawData: unknown): ConnectionArtifacts {
  const data = rawData as Record<string, any> | null | undefined;
  const qr = data?.qrcode;
  const instance = data?.instance;

  const qrCode =
    qr?.base64 ||
    qr?.code ||
    data?.base64 ||
    data?.code ||
    instance?.qrcode?.base64 ||
    instance?.qrcode?.code ||
    instance?.qrcode ||
    null;

  const pairingCode =
    data?.pairingCode ||
    data?.pairing_code ||
    qr?.pairingCode ||
    qr?.pairing_code ||
    instance?.pairingCode ||
    instance?.pairing_code ||
    null;

  return {
    qrCode: typeof qrCode === "string" ? qrCode : null,
    pairingCode: typeof pairingCode === "string" ? pairingCode : null,
  };
}

function extractMatchingInstance(rawData: unknown, instanceName: string): Record<string, any> | null {
  const candidates: any[] = [];
  const data = rawData as any;

  if (Array.isArray(data)) {
    candidates.push(...data);
  } else if (data && typeof data === "object") {
    if (Array.isArray(data.instances)) {
      candidates.push(...data.instances);
    } else if (Array.isArray(data.data)) {
      candidates.push(...data.data);
    } else {
      candidates.push(...Object.values(data));
    }
  }

  return candidates.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const flatName = candidate.instanceName || candidate.name;
    const nestedName = candidate.instance?.instanceName || candidate.instance?.name;
    return flatName === instanceName || nestedName === instanceName;
  }) || null;
}

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
    const exists = !!extractMatchingInstance(rawData, instanceName);

    if (!exists) {
      console.warn(`[instanceExists] Instance ${instanceName} not found. Raw payload sample:`, rawData);
    }
    return exists;
  } catch (error) {
    console.error("[instanceExists] Error:", error);
    return false;
  }
}

/** Fetches the matching instance record from /instance/all if present. */
export async function getInstanceRecord(instanceName: string): Promise<Record<string, any> | null> {
  try {
    const rawData = await evoFetch("/instance/all", "GET");
    return extractMatchingInstance(rawData, instanceName);
  } catch (error) {
    console.error("[getInstanceRecord] Error:", error);
    return null;
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
export async function createInstance(instanceName: string, webhookUrl: string): Promise<ConnectionArtifacts> {
  const { apiKey } = getEvolutionConfig();
  const res = await evoFetch("/instance/create", "POST", {
    name: instanceName, // Evolution Go (Go port) uses 'name'
    instanceName: instanceName, // Send both just in case
    token: apiKey, // Provide token as required by the API
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
    webhook: webhookUrl, // Some versions expect a simple string
    webhookUrl: webhookUrl,
    webhook_url: webhookUrl,
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

  return parseConnectionArtifacts(res);
}

/**
 * Sets the webhook URL for an instance.
 * Called immediately after createInstance so all events flow to Convex.
 */
export async function setWebhook(instanceName: string, webhookUrl: string): Promise<void> {
  const payload = {
    url: webhookUrl,
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
  const attempts = [
    { path: `/webhook/instance/${instanceName}`, method: "POST" },
    { path: `/webhook/instance/${instanceName}`, method: "PUT" },
    { path: `/webhook/instance/${instanceName}`, method: "PATCH" },
    { path: `/webhook/set/${instanceName}`, method: "POST" },
    { path: `/webhook/set/${instanceName}`, method: "PUT" },
    { path: `/webhook/set/${instanceName}`, method: "PATCH" },
  ] as const;

  for (const attempt of attempts) {
    try {
      await evoFetch(attempt.path, attempt.method, payload);
      return;
    } catch (e: any) {
      if (!e.message.includes("404")) throw e;
    }
  }

  console.warn(`[setWebhook] No compatible webhook endpoint found for ${instanceName}.`);
}

/** Returns the current connection artifacts for an instance. */
export async function getConnectionArtifacts(instanceName: string): Promise<ConnectionArtifacts> {
  try {
    const record = await getInstanceRecord(instanceName);
    if (record) {
      const artifacts = parseConnectionArtifacts(record);
      if (artifacts.qrCode || artifacts.pairingCode) {
        return artifacts;
      }
    }
  } catch {
    // fall through to endpoint-specific probes
  }

  const paths = [
    `/instance/connect/${instanceName}`,
    `/instance/qrcode/${instanceName}`,
    `/instance/qr/${instanceName}`,
  ];

  for (const path of paths) {
    for (const method of ["GET", "POST"] as const) {
      try {
        const data = await evoFetch(path, method);
        const artifacts = parseConnectionArtifacts(data);
        if (artifacts.qrCode || artifacts.pairingCode) {
          return artifacts;
        }
      } catch {
        // Try the next compatible endpoint shape/method.
      }
    }
  }

  return { qrCode: null, pairingCode: null };
}

/** Backwards-compatible helper used by older call sites. */
export async function getQR(instanceName: string): Promise<string | null> {
  const { qrCode } = await getConnectionArtifacts(instanceName);
  return qrCode;
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
