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
        const rawState = (data as { state?: string; status?: string })?.state || (data as { status?: string })?.status || "";
        const statusCode = (data as any)?.statusCode || (data as any)?.StatusCode || 0;

        // Detect explicit logout/disconnect signals from Evolution Go
        const isLogout =
          (data as any)?.isLogout === true ||
          (data as any)?.IsLogout === true ||
          (data as any)?.is_logout === true;
        const isDisconnect =
          (data as any)?.isDisconnect === true ||
          (data as any)?.IsDisconnect === true;

        // statusCode 428 = "logged out from phone" (WhatsApp multi-device unlink)
        // statusCode 401 = "unauthorized" (session revoked)
        // statusCode 515 = "stream error" (persistent connection failure)
        const isForceDisconnect =
          isLogout ||
          isDisconnect ||
          statusCode === 428 ||
          statusCode === 401 ||
          statusCode === 515;

        console.log(`[Webhook Evolution] CONNECTION_UPDATE for ${instance}: state=${rawState}, statusCode=${statusCode}, isLogout=${isLogout}, isDisconnect=${isDisconnect}`);

        if (isForceDisconnect) {
          // User explicitly logged out from phone or session was revoked.
          // Immediately mark as disconnected — no need to verify.
          console.log(`[Webhook Evolution] Force disconnect detected for ${instance} (statusCode=${statusCode}, isLogout=${isLogout})`);
          await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
            businessId: business._id,
            status: "disconnected",
          });
        } else if (rawState === "open") {
          // CRITICAL: `state === "open"` in the webhook can mean the WebSocket
          // to WhatsApp servers is open, but NOT that the user has scanned the
          // QR code. We must verify with the full status endpoint (which checks
          // `LoggedIn`) before marking the business as "connected".
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
          // Only set "pending" if the DB status is already "pending" (user-initiated
          // reconnect flow). If DB says "disconnected", this is just Evolution Go
          // trying to auto-reconnect after a disconnect — leave it as disconnected
          // so the dashboard shows the Reconnect button instead of "Reconnecting…".
          if (business.whatsappStatus === "pending") {
            // Already pending — no need to write again
          } else if (business.whatsappStatus === "connected") {
            // Transitioning from connected → connecting means something went wrong
            await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
              businessId: business._id,
              status: "pending",
            });
          }
          // If disconnected/error → ignore "connecting" (auto-reconnect noise)
        } else if (rawState === "close" || rawState === "closed") {
          // Explicit close state — mark as disconnected
          await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
            businessId: business._id,
            status: "disconnected",
          });
        } else if (rawState) {
          // Unknown state — log it and verify with Evolution Go
          console.warn(`[Webhook Evolution] Unknown connection state "${rawState}" for ${instance}, verifying...`);
          try {
            const fullStatus = await evoClient.getInstanceStatus(instance);
            const isFullyAuthenticated = fullStatus.connected && fullStatus.loggedIn;
            await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
              businessId: business._id,
              status: isFullyAuthenticated ? "connected" : "disconnected",
            });
          } catch (verifyError) {
            console.warn("[Webhook Evolution] Could not verify unknown state:", verifyError);
          }
        }
        // If rawState is empty and not a force disconnect, ignore — likely a partial/noise event
      } else if (eventUpper === "MESSAGES_UPSERT" || eventUpper === "MESSAGE") {
        // Evolution Go sends individual message objects; Node.js wraps in { messages: [] }
        const messages = (data as { messages?: unknown[] })?.messages || [data];
        for (const msg of messages) {
          const m = msg as {
            key?: { remoteJid?: string; fromMe?: boolean; id?: string };
            message?: {
              conversation?: string;
              extendedTextMessage?: { text?: string };
              imageMessage?: { url?: string; caption?: string; mimetype?: string };
              videoMessage?: { url?: string; caption?: string; mimetype?: string };
              audioMessage?: { url?: string; mimetype?: string };
              documentMessage?: { url?: string; fileName?: string; mimetype?: string };
            };
            pushName?: string;
            messageType?: string;
            messageTimestamp?: number;
          };

          const remoteJid = m.key?.remoteJid || "";
          const fromMe = m.key?.fromMe ?? false;
          const isGroup = remoteJid.endsWith("@g.us");
          const timestamp = (m.messageTimestamp || Date.now() / 1000) * 1000;

          if (!remoteJid) continue;

          // Extract content — text messages use conversation/extendedText,
          // media messages may have captions
          const imageMsg = m.message?.imageMessage;
          const videoMsg = m.message?.videoMessage;
          const audioMsg = m.message?.audioMessage;
          const docMsg = m.message?.documentMessage;

          const content =
            m.message?.conversation ||
            m.message?.extendedTextMessage?.text ||
            imageMsg?.caption ||
            videoMsg?.caption ||
            "";

          // Determine message type from actual message content
          let messageType: "text" | "image" | "video" | "audio" | "document" | "location" = "text";
          let mediaUrl: string | undefined;

          if (imageMsg) {
            messageType = "image";
            mediaUrl = imageMsg.url;
          } else if (videoMsg) {
            messageType = "video";
            mediaUrl = videoMsg.url;
          } else if (audioMsg) {
            messageType = "audio";
            mediaUrl = audioMsg.url;
          } else if (docMsg) {
            messageType = "document";
            mediaUrl = docMsg.url;
          } else if (m.messageType) {
            messageType = m.messageType as typeof messageType;
          }

          const result = await ctx.runMutation(api.whatsapp.receiveMessage, {
            businessId: business._id,
            sender: remoteJid,
            content,
            timestamp,
            fromMe,
            isGroup,
            messageType,
            name: m.pushName,
            whatsappMessageId: m.key?.id,
          });

          // If this is a media message with a URL and it's from a customer,
          // trigger AI image analysis asynchronously
          if (!fromMe && mediaUrl && (messageType === "image" || messageType === "video")) {
            const resultObj = result as { success?: boolean; messageId?: string } | undefined;
            // We need the interaction ID — it was just created in receiveMessage
            // Schedule vision analysis if we have a URL
            try {
              // Find the just-created interaction by whatsapp message ID
              if (m.key?.id) {
                await ctx.scheduler.runAfter(500, api.ai.analyzeImage, {
                  businessId: business._id,
                  interactionId: resultObj?.messageId as any, // Will be resolved by the action
                  customerId: "" as any, // Will be looked up in the action
                  imageUrl: mediaUrl,
                  caption: content || undefined,
                });
              }
            } catch (imgErr) {
              console.warn("[Webhook Evolution] Could not schedule image analysis:", imgErr);
            }
          }
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
