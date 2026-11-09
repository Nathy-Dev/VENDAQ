import { auth } from "../../../../../auth";
import { mintConvexToken } from "@/lib/convex-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", Vary: "Cookie" };
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "FORBIDDEN" }, { status: 403, headers });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers });
  try {
    return Response.json({ token: await mintConvexToken(session.user.id) }, { headers });
  } catch {
    return Response.json({ error: "AUTH_BRIDGE_NOT_CONFIGURED" }, { status: 503, headers });
  }
}
