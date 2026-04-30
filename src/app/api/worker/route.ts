import { NextResponse } from 'next/server';
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, businessId, qrCodeString, status } = body;

    if (action === 'getConnectedBusinesses') {
        const businesses = await fetchQuery(api.whatsapp.getConnectedBusinesses);
        return NextResponse.json({ success: true, businesses });
    }

    if (!businessId || typeof businessId !== 'string') {
        return NextResponse.json({ error: "Invalid businessId provided" }, { status: 400 });
    }

    if (action === 'updateQRCode' && qrCodeString) {
      console.log(`[Next.js Proxy] Received QR Code for ${businessId}, sending to Convex`);
      await fetchMutation(api.whatsapp.updateQRCode, {
        businessId: businessId as Id<"businesses">,
        qrCodeString,
      });
      console.log(`[Next.js Proxy] Successfully updated QR for ${businessId} in Convex`);
      return NextResponse.json({ success: true });
    }

    if (action === 'updateStatus' && status) {
      await fetchMutation(api.whatsapp.updateConnectionStatus, {
        businessId: businessId as Id<"businesses">,
        status: status as "connected" | "disconnected" | "error",
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'updatePairingCode') {
        const { pairingCode } = body;
        await fetchMutation(api.whatsapp.updatePairingCode, {
            businessId: businessId as Id<"businesses">,
            pairingCode,
        });
        return NextResponse.json({ success: true });
    }

    if (action === 'updateContactName') {
        const { phone, name, isGroup, createIfMissing } = body;
        await fetchMutation(api.whatsapp.updateContactName, {
            businessId: businessId as Id<"businesses">,
            phone,
            name,
            isGroup: !!isGroup,
            createIfMissing,
        });
        return NextResponse.json({ success: true });
    }

    if (action === 'newMessage') {
        const { sender, content, timestamp, fromMe, isGroup, groupMetadata, messageType, mediaId, fileName, name, whatsappMessageId } = body;
        await fetchMutation(api.whatsapp.receiveMessage, {
            businessId: businessId as Id<"businesses">,
            sender,
            content,
            timestamp: timestamp || Date.now(),
            fromMe: !!fromMe,
            isGroup,
            groupMetadata,
            messageType,
            mediaId,
            fileName,
            name,
            whatsappMessageId,
        });

        if (!fromMe && !isGroup && messageType === "text") {
          await fetchAction(api.whatsapp.handleOwnerAssistantMessage, {
            businessId: businessId as Id<"businesses">,
            sender,
            content,
          });
        }

        return NextResponse.json({ success: true });
    }

    if (action === 'updateMessage') {
        const { whatsappMessageId, content, isDeleted } = body;
        await fetchMutation(api.whatsapp.updateMessage, {
            businessId: businessId as Id<"businesses">,
            whatsappMessageId,
            content,
            isDeleted,
        });
        return NextResponse.json({ success: true });
    }

    if (action === 'syncHistory') {
        const { history } = body;
        const maxBatchSize = Number(process.env.HISTORY_SYNC_MAX_BATCH || 250);
        const batchSize = Array.isArray(history) ? history.length : 0;
        console.log(`[Next.js Proxy] Received history sync for ${businessId}: ${batchSize} items`);

        if (!Array.isArray(history)) {
          return NextResponse.json({ error: "history must be an array" }, { status: 400 });
        }
        if (batchSize > maxBatchSize) {
          return NextResponse.json(
            { error: `history batch too large; max allowed is ${maxBatchSize}` },
            { status: 413 }
          );
        }
        
        await fetchMutation(api.whatsapp.syncHistory, {
            businessId: businessId as Id<"businesses">,
            history,
        });
        
        return NextResponse.json({ success: true, count: batchSize });
    }
    if (action === 'syncStatus') {
        const { sender, content, mediaId, mediaType, timestamp, whatsappMessageId } = body;
        await fetchMutation(api.whatsapp.syncStatus, {
            businessId: businessId as Id<"businesses">,
            sender,
            content,
            mediaId,
            mediaType,
            timestamp,
            whatsappMessageId,
        });
        return NextResponse.json({ success: true });
    }

    if (action === 'syncStatusView') {
        const { whatsappStatusId, viewerPhone, timestamp } = body;
        await fetchMutation(api.whatsapp.syncStatusView, {
            businessId: businessId as Id<"businesses">,
            whatsappStatusId,
            viewerPhone,
            timestamp,
        });
        return NextResponse.json({ success: true });
    }



    return NextResponse.json({ error: "Invalid action payload" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Worker Webhook Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
