import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CodexCloudError, startDeviceCode } from "@/lib/codex-cloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const flow = await startDeviceCode();
    const jar = await cookies();
    const expiresAt = Date.parse(flow.expires_at);
    const ttlSeconds = Number.isFinite(expiresAt)
      ? Math.max(60, Math.floor((expiresAt - Date.now()) / 1000))
      : 900;
    jar.set("codex_device_auth_id", flow.device_auth_id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ttlSeconds,
    });
    jar.set("codex_user_code", flow.user_code, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ttlSeconds,
    });
    return NextResponse.json({
      user_code: flow.user_code,
      verification_url: flow.verification_url,
      verification_uri_complete: `${flow.verification_url}?user_code=${encodeURIComponent(flow.user_code)}`,
      interval: flow.interval,
      expires_at: flow.expires_at,
    });
  } catch (err) {
    console.error("[codex/device/start] failed:", err);
    const status = err instanceof CodexCloudError ? err.status : 502;
    const message =
      err instanceof CodexCloudError
        ? err.message
        : "Couldn't reach OpenAI to start the Codex login.";
    return NextResponse.json({ error: message }, { status });
  }
}
