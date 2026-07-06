import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import * as evoClient from "./evolutionGoClient";

const http = httpRouter();

/**
 * Receives all events from Evolution Go running on Hostinger VPS.
 * Evolution Go sends a POST to this URL for every WhatsApp event.
 *
 * Payload shape:
 *   { event: "MESSAGES_UPSERT" | "CONNECTION_UPDATE" | "QRCODE_UPDATED" | ...,
 *     instance: "<human-readable-instance-name>",
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

      let business = await ctx.runQuery(api.businesses.getBusinessByEvolutionInstanceName, {
        instanceName: instance,
      });

      if (!business && instance?.startsWith("pipelixr_")) {
        const legacyBusinessId = instance.replace(/^pipelixr_/, "");
        business = await ctx.runQuery(api.businesses.getBusinessById, {
          businessId: legacyBusinessId as Id<"businesses">,
        });
      }

      if (!business) {
        return new Response(JSON.stringify({ error: "Cannot resolve business from instance name" }), { status: 400 });
      }

      const eventUpper = (event || "").toUpperCase();

      // Handle both Evolution Go (Go port) and Evolution API (Node.js) event name variants
      if (eventUpper === "QRCODE_UPDATED" || eventUpper === "QRCODE") {
        const qr = (data as { qrcode?: { base64?: string; code?: string } })?.qrcode;
        // Evolution Go may put the base64 directly on data
        const qrString = qr?.base64 || qr?.code || (data as { base64?: string })?.base64 || (data as { code?: string })?.code || "";
        if (qrString) {
          await ctx.runMutation(api.whatsapp.updateQRCode, {
            businessId: business._id,
            qrCodeString: qrString,
          });
        }
      } else if (eventUpper === "CONNECTION_UPDATE" || eventUpper === "CONNECTION") {
        const rawState = (data as { state?: string; status?: string })?.state || (data as { status?: string })?.status || "close";

        // CRITICAL: `state === "open"` in the webhook can mean the WebSocket
        // to WhatsApp servers is open, but NOT that the user has scanned the
        // QR code. We must verify with the full status endpoint (which checks
        // `LoggedIn`) before marking the business as "connected".
        if (rawState === "open") {
          // Check if the webhook data itself carries auth confirmation
          const webhookLoggedIn =
            (data as any)?.loggedIn === true ||
            (data as any)?.LoggedIn === true ||
            (data as any)?.logged_in === true ||
            (data as any)?.isNewLogin === true;

          if (webhookLoggedIn) {
            // Webhook explicitly confirms authentication — trust it
            await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
              businessId: business._id,
              status: "connected",
            });
          } else {
            // Webhook says "open" but no auth proof — verify via status endpoint
            try {
              const fullStatus = await evoClient.getInstanceStatus(instance);
              if (fullStatus.connected && fullStatus.loggedIn) {
                await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
                  businessId: business._id,
                  status: "connected",
                });
              }
              // If not authenticated, don't change status — the poller will
              // confirm once the QR is actually scanned.
            } catch (verifyError) {
              console.warn("[Webhook Evolution] Could not verify connection status:", verifyError);
              // Don't update — the poller will handle it
            }
          }
        } else if (rawState === "connecting") {
          await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
            businessId: business._id,
            status: "pending",
          });
        } else {
          // "close" or any other state
          await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
            businessId: business._id,
            status: "disconnected",
          });
        }
      } else if (eventUpper === "MESSAGES_UPSERT" || eventUpper === "MESSAGE") {
        // Evolution Go sends individual message objects; Node.js wraps in { messages: [] }
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

          if (!remoteJid) continue;

          await ctx.runMutation(api.whatsapp.receiveMessage, {
            businessId: business._id,
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
      // SEND_MESSAGE, READ_RECEIPT, PRESENCE and other events are intentionally ignored

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
