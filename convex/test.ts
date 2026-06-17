import { action } from "./_generated/server";
import { createInstance, connectInstance, pairInstance, getEvolutionWebhookUrl, generateEvolutionInstanceId } from "./evolutionGoClient";

export const testEvolution = action({
  args: {},
  handler: async (ctx) => {
    try {
        const instanceName = "test_" + Date.now();
        const instanceId = generateEvolutionInstanceId();
        const createRes = await createInstance(instanceName, {
            displayName: "Pipelixr Test",
            instanceId,
            token: "test_token_123",
        });

        let connectRes, connectErr;
        try {
            connectRes = await connectInstance(instanceName, {
                instanceId,
                webhookUrl: getEvolutionWebhookUrl() || "https://example.com/webhook",
                subscribe: ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT"],
            });
        } catch(e: any) {
            connectErr = e.message;
        }

        let pairRes, pairErr;
        try {
            pairRes = await pairInstance(instanceName, "5511999999999", {
                instanceId,
                subscribe: ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT"],
            });
        } catch(e: any) {
            pairErr = e.message;
        }

        return { createRes, connectRes, connectErr, pairRes, pairErr };
    } catch(e: any) {
        return { error: e.message };
    }
  }
});
