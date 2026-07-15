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

      // GLOBAL CATCH-ALL: logs every request before any filtering so we can
      // confirm payloads are reaching Convex regardless of event type or instance.
      const _rawEvent = body.event || body.Event || body.event_type || body.EventType || "(none)";
      const _rawChat = (body.data as any)?.key?.remoteJid
        || (body.data as any)?.Info?.Chat
        || (body.data as any)?.Info?.RemoteJid
        || "(none)";
      console.warn(`[Webhook Global] event=${_rawEvent} | chat=${JSON.stringify(_rawChat)} | bodyKeys=${Object.keys(body).join(",")}`);

      // Evolution Go (Go port) may use different field names/casing than Evolution API (Node.js).
      // Go's default JSON serialization uses PascalCase, and different versions may use
      // snake_case or camelCase. Extract from all known variants.
      const event: string =
        body.event || body.Event || body.event_type || body.EventType || "";

      // Try body fields first, then headers, then URL path
      let instance: string =
        body.instance || body.Instance ||
        body.instanceName || body.InstanceName || body.instance_name ||
        body.apikey || body.Apikey || body.token || body.Token ||
        // Some Evolution Go versions nest instance info inside data
        body.data?.instance || body.data?.Instance ||
        body.data?.instanceName || body.data?.InstanceName ||
        body.data?.instance_name ||
        "";

      // Fallback: check request headers (Evolution Go may send instance token as apikey header)
      if (!instance) {
        instance =
          request.headers.get("apikey") ||
          request.headers.get("x-instance-name") ||
          request.headers.get("x-instance") ||
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
          "";
      }

      const data: Record<string, unknown> = body.data || body.Data || body;

      // Debug: log the raw payload shape so we can diagnose field naming issues
      if (process.env.EVOLUTION_GO_DEBUG) {
        console.log("[Webhook Evolution] Raw payload keys:", Object.keys(body), "event:", event, "instance:", instance);
      }

      if (!instance) {
        // Always log full payload keys + a truncated body sample for debugging
        const bodySample = JSON.stringify(body).slice(0, 500);
        console.warn("[Webhook Evolution] Received event without instance name, ignoring.", {
          event,
          bodyKeys: Object.keys(body),
          dataKeys: body.data ? Object.keys(body.data) : [],
          bodySample,
        });
        return new Response(JSON.stringify({ ok: true, skipped: "no instance name" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

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
        console.warn(`[Webhook Evolution] Cannot resolve business from instance="${instance}". Available instance names may not match.`);
        return new Response(JSON.stringify({ error: "Cannot resolve business from instance name", receivedInstance: instance }), { status: 400 });
      }

      const eventUpper = (event || "").toUpperCase();

      // Handle both Evolution Go (Go port) and Evolution API (Node.js) event name variants
      if (eventUpper === "RECEIPT" || eventUpper === "READ_RECEIPT" || eventUpper === "MESSAGES_READ") {
        // Evolution Go (Go port) sends receipt events for status views.
        // A status view receipt looks like:
        //   Receipt received with ID: <statusMsgId> from <viewer@lid> in status@broadcast with type read
        // The data shape varies. Try to extract from common formats.
        const receiptData = data as Record<string, any>;
        const receiptType = receiptData.type || receiptData.Type || receiptData.receiptType || "";
        const remoteJid = receiptData.remoteJid || receiptData.RemoteJid || "";
        const chatJid = receiptData.chat || receiptData.Chat || receiptData.fromJid || receiptData.FromJid || "";
        const messageId = receiptData.id || receiptData.ID || receiptData.messageId || receiptData.MessageId || "";
        const viewerJid = receiptData.sender || receiptData.Sender || receiptData.from || receiptData.From || "";

        // Try nested data object (Go port may nest inside data.Receipt)
        const rcptData = receiptData.Receipt || receiptData.receipt || receiptData.data || {};
        const rcptType = rcptData.type || rcptData.Type || rcptData.receiptType || receiptType;
        const rcptChat = rcptData.Chat || rcptData.chat || rcptData.remoteJid || rcptData.RemoteJid || chatJid;
        const rcptMsgId = rcptData.ID || rcptData.id || rcptData.messageId || messageId;
        const rcptSender = rcptData.Sender || rcptData.sender || rcptData.from || viewerJid;

        // Determine if this is a status view receipt (either chat is status@broadcast or remoteJid contains it)
        const isStatusView = (
          rcptChat === "status@broadcast" ||
          remoteJid === "status@broadcast" ||
          chatJid === "status@broadcast" ||
          (rcptChat && rcptChat.includes("status")) ||
          (remoteJid && remoteJid.includes("status"))
        );
        const isReadType = rcptType.toLowerCase() === "read" || receiptType.toLowerCase() === "read";

        if (isStatusView && isReadType && (rcptMsgId || messageId)) {
          const finalViewerJid = rcptSender || viewerJid;
          const finalMsgId = rcptMsgId || messageId;

          console.log(`[Webhook Evolution] Status view receipt: msgId=${finalMsgId}, viewer=${finalViewerJid}`);

          if (finalViewerJid && finalMsgId) {
            // Extract the phone number from @lid or @s.whatsapp.net format
            // WhatsApp privacy LID format: "254906611064927@lid" or "254906611064927@s.whatsapp.net"
            const viewerPhone = finalViewerJid.includes("@")
              ? finalViewerJid.split("@")[0]
              : finalViewerJid;

            await ctx.runMutation(api.whatsapp.syncStatusView, {
              businessId: business._id,
              whatsappStatusId: finalMsgId,
              viewerPhone,
              timestamp: Date.now(),
            });
          }
        } else {
          console.log(`[Webhook Evolution] Non-status receipt ignored: type=${rcptType || receiptType}, chat=${rcptChat || remoteJid || chatJid}`);
        }
      } else if (eventUpper === "QRCODE_UPDATED" || eventUpper === "QRCODE") {
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
          // Explicit close state — but don't revert if we're in the middle of
          // a reconnect flow (status === "pending"). During reconnection,
          // Evolution Go often sends a "close" event for the OLD session right
          // before the new QR/connection is established. Reverting to
          // "disconnected" here would cause the dashboard to falsely show
          // "QR code expired" seconds after the user clicked Reconnect.
          // The reconnect poll and timeout will handle actual failures.
          if (business.whatsappStatus === "pending") {
            console.log(`[Webhook Evolution] Ignoring "close" event during pending reconnect for ${instance}`);
          } else {
            await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
              businessId: business._id,
              status: "disconnected",
            });
          }
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
              imageMessage?: Record<string, unknown>;
              videoMessage?: Record<string, unknown>;
              audioMessage?: Record<string, unknown>;
              documentMessage?: Record<string, unknown>;
            };
            pushName?: string;
            messageType?: string;
            messageTimestamp?: number;
            // Evolution Go alternate fields
            remoteJid?: string;
            id?: string;
            fromMe?: boolean;
            text?: string;
            // Evolution Go / whatsmeow Info struct
            Info?: {
              Chat?: string | { user?: string; server?: string };
              Sender?: string | { user?: string; server?: string };
              RemoteJid?: string;
              ID?: string;
              IsFromMe?: boolean;
              PushName?: string;
              Timestamp?: string | number;
            };
            Message?: Record<string, unknown>;
          };

          if (process.env.EVOLUTION_GO_DEBUG) {
             console.log("[Webhook Evolution] Processing message payload:", JSON.stringify(m).slice(0, 500));
          }

          // Helper to extract JID — handles both camelCase (Node.js/Baileys) and
          // PascalCase (Go/whatsmeow JSON serialization: { User, Server })
          const extractJid = (jid: any): string => {
            if (typeof jid === "string") return jid;
            const user = jid?.user || jid?.User || "";
            const server = jid?.server || jid?.Server || "";
            if (user && server) return `${user}@${server}`;
            return "";
          };

          // Try standard Node.js format first, fallback to flattened Go format, then Info format
          const remoteJid = m.key?.remoteJid || m.remoteJid || extractJid(m.Info?.RemoteJid) || extractJid(m.Info?.Chat) || extractJid(m.Info?.Sender) || "";
          const fromMe = m.key?.fromMe ?? m.fromMe ?? m.Info?.IsFromMe ?? (m as any).IsFromMe ?? false;
          const isGroup = remoteJid.endsWith("@g.us");
          const isStatusBroadcast = remoteJid === "status@broadcast";
          const messageId = m.key?.id || m.id || m.Info?.ID || "";
          
          let timestamp = Date.now();
          if (m.messageTimestamp) {
            timestamp = m.messageTimestamp * 1000;
          } else if (m.Info?.Timestamp) {
            // Timestamp might be a string (ISO) or number (seconds)
            timestamp = typeof m.Info.Timestamp === "string" ? new Date(m.Info.Timestamp).getTime() : m.Info.Timestamp * 1000;
          }

          const pushName = m.pushName || m.Info?.PushName;

          if (!remoteJid) {
             console.warn("[Webhook Evolution] Skipping message because remoteJid is missing", { msgKeys: Object.keys(m), infoKeys: m.Info ? Object.keys(m.Info) : [] });
             continue;
          }

          // Extract content — text messages use conversation/extendedText,
          // media messages may have captions
          const msgObj = m.message || m.Message;
          const imageMsg = msgObj?.imageMessage as Record<string, any> | undefined;
          const videoMsg = msgObj?.videoMessage as Record<string, any> | undefined;
          const audioMsg = msgObj?.audioMessage as Record<string, any> | undefined;
          const docMsg = msgObj?.documentMessage as Record<string, any> | undefined;

          // Safely extract from msgObj treating it as any to bypass TS Record<string, unknown> strictness
          const content =
            (msgObj as any)?.conversation ||
            (msgObj as any)?.extendedTextMessage?.text ||
            m.text || // Evolution Go flat text
            imageMsg?.caption ||
            videoMsg?.caption ||
            "";

          // Determine message type from actual message content
          let messageType: "text" | "image" | "video" | "audio" | "document" | "location" = "text";
          let mediaUrl: string | undefined;
          let mediaMimetype: string | undefined;

          if (imageMsg) {
            messageType = "image";
            mediaUrl = imageMsg.url;
            mediaMimetype = imageMsg.mimetype || "image/jpeg";
          } else if (videoMsg) {
            messageType = "video";
            mediaUrl = videoMsg.url;
            mediaMimetype = videoMsg.mimetype || "video/mp4";
          } else if (audioMsg) {
            messageType = "audio";
            mediaUrl = audioMsg.url;
            mediaMimetype = audioMsg.mimetype || "audio/ogg";
          } else if (docMsg) {
            messageType = "document";
            mediaUrl = docMsg.url;
            mediaMimetype = docMsg.mimetype || "application/octet-stream";
          } else if (m.messageType) {
            messageType = m.messageType as typeof messageType;
          }

          // ── Status broadcast messages (business owner's own statuses) ──
          // When the business owner posts a status, Evolution Go fires MESSAGES_UPSERT
          // with remoteJid = "status@broadcast". We need to:
          //   - fromMe === true: Record the status via syncStatus (it's the owner's own status)
          //   - fromMe === false: Discard (contacts' statuses are not our concern)
          if (isStatusBroadcast) {
            if (fromMe) {
              console.warn(`[Webhook Evolution] Owner status broadcast: id=${messageId}, type=${messageType}`);
              await ctx.runMutation(api.whatsapp.syncStatus, {
                businessId: business._id,
                sender: remoteJid,
                content: content as string,
                mediaId: undefined,
                mediaType: messageType !== "text" ? messageType : undefined,
                timestamp,
                whatsappMessageId: messageId,
              });
            } else {
              console.warn(`[Webhook Evolution] Contact status broadcast (ignored): id=${messageId}, fromMe=${fromMe}, remoteJid=${remoteJid}`);
            }
            continue; // Skip normal message processing for status broadcasts
          }

          const result = await ctx.runMutation(api.whatsapp.receiveMessage, {
            businessId: business._id,
            sender: remoteJid,
            content: content as string,
            timestamp,
            fromMe,
            isGroup,
            messageType,
            name: m.pushName,
            whatsappMessageId: messageId,
          });

          const resultObj = result as { success?: boolean; discarded?: boolean } | undefined;

          // ── Media pipeline: download → Cloudinary → Vision AI → react ──
          // Schedule for ALL media types from customers (images, videos, audio, docs).
          // processMediaMessage handles: Cloudinary storage for all, Vision for images/videos.
          if (
            !fromMe &&
            !resultObj?.discarded &&
            messageType !== "text" &&
            messageId &&
            remoteJid
          ) {
            try {
              // Build the raw message object for Evolution Go download endpoint
              const rawMessageObj: Record<string, unknown> = {};
              if (imageMsg) rawMessageObj.imageMessage = imageMsg;
              if (videoMsg) rawMessageObj.videoMessage = videoMsg;
              if (audioMsg) rawMessageObj.audioMessage = audioMsg;
              if (docMsg) rawMessageObj.documentMessage = docMsg;

              await ctx.scheduler.runAfter(500, api.ai.processMediaMessage, {
                businessId: business._id,
                sender: remoteJid,
                whatsappMessageId: messageId,
                messageKey: {
                  remoteJid,
                  fromMe: false,
                  id: messageId,
                },
                rawMessage: JSON.stringify(rawMessageObj),
                messageType,
                mimetype: mediaMimetype || "application/octet-stream",
                caption: (content as string) || undefined,
                fallbackMediaUrl: mediaUrl,
              });
            } catch (mediaErr) {
              console.warn("[Webhook Evolution] Could not schedule media processing:", mediaErr);
            }
          }

          // ── Mark text messages as read (media messages get marked in processMediaMessage) ──
          if (
            !fromMe &&
            !resultObj?.discarded &&
            messageType === "text" &&
            messageId &&
            remoteJid
          ) {
            try {
              await ctx.scheduler.runAfter(1000, api.whatsapp.markInboundAsRead, {
                businessId: business._id,
                messages: [
                  {
                    remoteJid,
                    fromMe: false,
                    id: messageId,
                  },
                ],
              });
            } catch (readErr) {
              console.warn("[Webhook Evolution] Could not schedule mark-as-read:", readErr);
            }
          }
        }
      } else if (eventUpper === "STATUS" || eventUpper === "STATUS_FIND" || eventUpper === "STATUS_UPDATE") {
        // Evolution Go sends STATUS events when the owner posts or views a status.
        // Payload shape varies; try to extract status data.
        const statusData = data as Record<string, any>;
        const statusMessages = statusData.messages || statusData.Messages || [statusData];

        for (const sm of Array.isArray(statusMessages) ? statusMessages : [statusMessages]) {
          const smData = sm as Record<string, any>;
          const msgId = smData.id || smData.ID || smData.key?.id || smData.messageId || "";
          const fromMe = smData.fromMe ?? smData.key?.fromMe ?? smData.IsFromMe ?? true;
          const msgTimestamp = smData.timestamp || smData.messageTimestamp
            ? (smData.timestamp || smData.messageTimestamp) * (smData.timestamp > 1e12 ? 1 : 1000)
            : Date.now();

          // Text content
          const msgContent =
            smData.caption || smData.text || smData.body ||
            smData.message?.conversation || smData.message?.extendedTextMessage?.text ||
            "";

          // Media type detection
          let mediaType: string | undefined;
          if (smData.message?.imageMessage || smData.mediatype === "image") mediaType = "image";
          else if (smData.message?.videoMessage || smData.mediatype === "video") mediaType = "video";

          if (fromMe && msgId) {
            console.log(`[Webhook Evolution] STATUS event: owner posted status id=${msgId}`);
            await ctx.runMutation(api.whatsapp.syncStatus, {
              businessId: business._id,
              sender: "status@broadcast",
              content: msgContent || undefined,
              mediaId: undefined,
              mediaType,
              timestamp: typeof msgTimestamp === "number" ? msgTimestamp : Date.now(),
              whatsappMessageId: msgId,
            });
          }
        }
      } else if (eventUpper === "SEND_MESSAGE") {
        // Evolution Go also fires SEND_MESSAGE for outbound messages including status posts.
        // Check if it's a status broadcast.
        const sendData = data as Record<string, any>;
        const remoteJid = sendData.key?.remoteJid || sendData.remoteJid || sendData.to || "";
        const msgId = sendData.key?.id || sendData.id || sendData.messageId || "";

        if (remoteJid === "status@broadcast" && msgId) {
          const msgContent =
            sendData.message?.conversation ||
            sendData.message?.extendedTextMessage?.text ||
            sendData.message?.imageMessage?.caption ||
            sendData.text || sendData.caption || "";

          let mediaType: string | undefined;
          if (sendData.message?.imageMessage) mediaType = "image";
          else if (sendData.message?.videoMessage) mediaType = "video";

          console.log(`[Webhook Evolution] SEND_MESSAGE status broadcast: id=${msgId}`);
          await ctx.runMutation(api.whatsapp.syncStatus, {
            businessId: business._id,
            sender: "status@broadcast",
            content: msgContent || undefined,
            mediaId: undefined,
            mediaType,
            timestamp: Date.now(),
            whatsappMessageId: msgId,
          });
        }
      }
      // PRESENCE and other events are intentionally ignored.
      // RECEIPT events are handled above for status view tracking.

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
