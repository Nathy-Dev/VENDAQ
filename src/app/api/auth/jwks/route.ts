import { publicJwks } from "@/lib/convex-auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await publicJwks(), { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    return Response.json({ error: "AUTH_BRIDGE_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
