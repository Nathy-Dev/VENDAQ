import { action } from "./_generated/server";
import { evoFetch } from "./evolutionGoClient";

export const testEvolution = action({
  args: {},
  handler: async (ctx) => {
    try {
        const instanceName = "test_" + Date.now();
        const createRes = await evoFetch("/instance/create", "POST", {
            name: instanceName,
            instanceName: instanceName,
            token: "test_token_123",
            qrcode: true,
            integration: "WHATSAPP-BAILEYS"
        });

        let webhookRes, webhookErr;
        try {
             webhookRes = await evoFetch(`/webhook/instance/${instanceName}`, "POST", {
                url: "https://example.com/webhook",
                webhook_by_events: false,
                webhook_base64: false,
                events: ["QRCODE", "MESSAGE"]
             });
        } catch(e: any) {
            webhookErr = e.message;
        }

        let connectRes, connectErr;
        try {
            connectRes = await evoFetch(`/instance/connect/${instanceName}`, "GET");
        } catch(e: any) {
            connectErr = e.message;
        }

        return { createRes, webhookRes, webhookErr, connectRes, connectErr };
    } catch(e: any) {
        return { error: e.message };
    }
  }
});
