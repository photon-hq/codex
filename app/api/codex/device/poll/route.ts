import { CodexCloudError, pollDeviceCode } from "@/lib/codex-cloud";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  const deviceAuthId = jar.get("codex_device_auth_id")?.value;
  const userCode = jar.get("codex_user_code")?.value;
  if (!deviceAuthId || !userCode) {
    return NextResponse.json(
      { status: "error", reason: "no codex device flow in progress" },
      { status: 400 },
    );
  }

  try {
    const result = await pollDeviceCode(deviceAuthId, userCode);
    if (result.status === "pending") {
      return NextResponse.json({ status: "pending" });
    }
    if (result.status === "expired") {
      jar.delete("codex_device_auth_id");
      jar.delete("codex_user_code");
      return NextResponse.json({ status: "expired" });
    }
    if (result.status === "error") {
      return NextResponse.json({ status: "error", reason: result.message }, { status: 502 });
    }
    jar.delete("codex_device_auth_id");
    jar.delete("codex_user_code");
    const tokenPayload = JSON.stringify({
      access_token: result.tokens.access_token,
      refresh_token: result.tokens.refresh_token,
      expires_at: result.tokens.expires_at,
      account_id: result.user.account_id,
      email: result.user.email,
      name: result.user.name,
    });
    jar.set("codex_pending_tokens", tokenPayload, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 30,
    });
    return NextResponse.json({
      status: "ok",
      user: {
        email: result.user.email,
        name: result.user.name,
        plan_type: result.user.plan_type,
        account_id: result.user.account_id,
      },
    });
  } catch (err) {
    console.error("[codex/device/poll] failed:", err);
    const status = err instanceof CodexCloudError ? err.status : 502;
    return NextResponse.json(
      { status: "error", reason: err instanceof Error ? err.message : "poll failed" },
      { status },
    );
  }
}
