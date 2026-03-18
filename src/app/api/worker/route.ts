import { NextResponse } from 'next/server';
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, businessId, qrCodeString, status } = body;

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
        status: status as any, // "connected" | "disconnected" | "error"
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'newMessage') {
        const { sender, content, timestamp, fromMe } = body;
        await fetchMutation(api.whatsapp.receiveMessage, {
            businessId: businessId as Id<"businesses">,
            sender,
            content,
            timestamp: timestamp || Date.now(),
            fromMe: !!fromMe,
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
  } catch (error: any) {
    console.error("Worker Webhook Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
