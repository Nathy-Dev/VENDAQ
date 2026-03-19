import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/api/worker",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { action, ...args } = body;
      
      console.log(`[HTTP Action] Received action: ${action}`);

      switch (action) {
        case 'syncHistory':
          await ctx.runMutation(api.whatsapp.syncHistory, {
              businessId: args.businessId,
              history: args.history
          });
          break;
        case 'newMessage':
          await ctx.runMutation(api.whatsapp.receiveMessage, {
              businessId: args.businessId,
              sender: args.sender,
              content: args.content,
              timestamp: args.timestamp,
              fromMe: args.fromMe
          });
          break;
        case 'updateQRCode':
          await ctx.runMutation(api.whatsapp.updateQRCode, {
              businessId: args.businessId,
              qrCodeString: args.qrCodeString
          });
          break;
        case 'updateStatus':
          // Map action payload 'status' to mutation args if needed
          await ctx.runMutation(api.whatsapp.updateConnectionStatus, {
              businessId: args.businessId,
              status: args.status
          });
          break;
        default:
          return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
      }

      return new Response(JSON.stringify({ success: true }), { 
          status: 200,
          headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error("[HTTP Action Error]:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return new Response(JSON.stringify({ error: errorMessage }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
      });
    }
  }),
});

export default http;
