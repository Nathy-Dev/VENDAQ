import { NextResponse } from 'next/server';
import { fetchMutation, fetchQuery } from "convex/nextjs";
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
        const { phone, name, isGroup } = body;
        await fetchMutation(api.whatsapp.updateContactName, {
            businessId: businessId as Id<"businesses">,
            phone,
            name,
            isGroup: !!isGroup,
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
        console.log(`[Next.js Proxy] Received heavy history sync for ${businessId}: ${history?.length || 0} items`);
        
        // We can chunk this if it's too large, but for now let's pass it through
        await fetchMutation(api.whatsapp.syncHistory, {
            businessId: businessId as Id<"businesses">,
            history: history || [],
        });
        
        return NextResponse.json({ success: true, count: history?.length || 0 });
    }



    return NextResponse.json({ error: "Invalid action payload" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Worker Webhook Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
