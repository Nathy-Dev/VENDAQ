import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

/**
 * Receives all events from Evolution Go running on Hostinger VPS.
 * Evolution Go sends a POST to this URL for every WhatsApp event.
 *
 * Payload shape:
 *   { event: "MESSAGES_UPSERT" | "CONNECTION_UPDATE" | "QRCODE_UPDATED" | ...,
 *     instance: "pipelixr_<businessId>",
 *     data: { ... } }
 */
http.route({
  path: "/api/webhook/evolution",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { event, instance, data } = body as {
        event: string;
        instance: string;
        data: Record<string, unknown>;
      };

      // Instance name is "pipelixr_<businessId>"
      const businessId = instance?.replace(/^pipelixr_/, "");
      if (!businessId) {
        return new Response(JSON.stringify({ error: "Cannot parse businessId from instance name" }), { status: 400 });
      }

      const eventUpper = (event || "").toUpperCase();

      if (eventUpper === "QRCODE_UPDATED") {
        const qr = (data as { qrcode?: { base64?: string; code?: string } })?.qrcode;
        const qrString = qr?.base64 || qr?.code || "";
        if (qrString) {
          await ctx.runMutation(api.whatsapp.updateQRCode, {
            businessId: businessId as Id<"businesses">,
            qrCodeString: qrString,
          });
        }
      } else if (eventUpper === "CONNECTION_UPDATE") {
        const state = (data as { state?: string })?.state || "close";
        const status =
          state === "open" ? "connected" :
          state === "connecting" ? "pending" :
          "disconnected";
        await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
          businessId: businessId as Id<"businesses">,
          status,
        });
      } else if (eventUpper === "MESSAGES_UPSERT") {
        const messages = (data as { messages?: unknown[] })?.messages || [data];
        for (const msg of messages) {
          const m = msg as {
            key?: { remoteJid?: string; fromMe?: boolean; id?: string };
            message?: { conversation?: string; extendedTextMessage?: { text?: string } };
            pushName?: string;
            messageType?: string;
            messageTimestamp?: number;
          };

          const remoteJid = m.key?.remoteJid || "";
          const fromMe = m.key?.fromMe ?? false;
          const content =
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text ||
            "";
          const isGroup = remoteJid.endsWith("@g.us");
          const timestamp = (m.messageTimestamp || Date.now() / 1000) * 1000;

          await ctx.runMutation(api.whatsapp.receiveMessage, {
            businessId: businessId as Id<"businesses">,
            sender: remoteJid,
            content,
            timestamp,
            fromMe,
            isGroup,
            messageType: (m.messageType as "text" | "image" | "video" | "audio" | "document" | "location") || "text",
            name: m.pushName,
          });
        }
      }
      // SEND_MESSAGE and other events are intentionally ignored

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("[Webhook Evolution] Error:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      return new Response(JSON.stringify({ error: msg }), { status: 500 });
    }
  }),
});

/**
 * Legacy /api/worker route kept for backward compatibility during migration.
 * Can be removed once wa-worker is fully decommissioned.
 */
http.route({
  path: "/api/worker",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { action, ...args } = body;

      switch (action) {
        case "syncHistory":
          await ctx.runMutation(api.whatsapp.syncHistory, {
            businessId: args.businessId,
            history: args.history,
          });
          break;
        case "newMessage":
          await ctx.runMutation(api.whatsapp.receiveMessage, {
            businessId: args.businessId,
            sender: args.sender,
            content: args.content,
            timestamp: args.timestamp,
            fromMe: args.fromMe,
            isGroup: args.isGroup,
            groupMetadata: args.groupMetadata,
            messageType: args.messageType,
            mediaId: args.mediaId,
            fileName: args.fileName,
            name: args.name,
          });
          break;
        case "updateQRCode":
          await ctx.runMutation(api.whatsapp.updateQRCode, {
            businessId: args.businessId,
            qrCodeString: args.qrCodeString,
          });
          break;
        case "updateStatus":
          await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
            businessId: args.businessId,
            status: args.status,
          });
          break;
        case "generateUploadUrl": {
          const uploadUrl = await ctx.runMutation(api.whatsapp.generateUploadUrl, {});
          return new Response(JSON.stringify({ uploadUrl }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        case "syncStatus":
          await ctx.runMutation(api.whatsapp.syncStatus, {
            businessId: args.businessId,
            sender: args.sender,
            content: args.content,
            mediaId: args.mediaId,
            mediaType: args.mediaType,
            timestamp: args.timestamp,
          });
          break;
        case "updateContactName":
          await ctx.runMutation(api.interactions.updateCustomerName, {
            businessId: args.businessId,
            phone: args.phone,
            name: args.name,
            isGroup: args.isGroup,
          });
          break;
        default:
          return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("[HTTP Action Error]:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return new Response(JSON.stringify({ error: errorMessage }), { status: 500 });
    }
  }),
});

http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
