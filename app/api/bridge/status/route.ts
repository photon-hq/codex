import { NextResponse } from "next/server";
import { getBridgeManager } from "@/bridge/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(req: Request): boolean {
  const token = process.env.BRIDGE_STATUS_TOKEN;
  if (token) {
    const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    return presented === token;
  }
  const url = new URL(req.url);
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(getBridgeManager().status());
}
