import { getSession, pollDeviceToken } from "@/lib/spectrum";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  const deviceCode = jar.get("device_code")?.value;
  if (!deviceCode) {
    return NextResponse.json(
      { status: "error", reason: "no device flow in progress" },
      { status: 400 },
    );
  }

  let result: Awaited<ReturnType<typeof pollDeviceToken>>;
  try {
    result = await pollDeviceToken(deviceCode);
  } catch (err) {
    console.error("[oauth/device/poll] failed:", err);
    const host = process.env.SPECTRUM_API_HOST ?? "<unset>";
    return NextResponse.json(
      { status: "error", reason: `Couldn't reach Spectrum at ${host}` },
      { status: 502 },
    );
  }

  if (result.ok) {
    jar.set("bearer", result.token.access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: result.token.expires_in ?? 60 * 60 * 24 * 7,
    });
    jar.delete("device_code");

    let user: { firstName: string | null; lastName: string | null; email: string | null } | null =
      null;
    try {
      const session = await getSession(result.token.access_token);
      if (session?.user) {
        const fullName = (session.user.name ?? "").trim();
        const [firstName, ...rest] = fullName.split(/\s+/);
        user = {
          firstName: firstName || null,
          lastName: rest.join(" ") || null,
          email: session.user.email ?? null,
        };
      }
    } catch {}

    return NextResponse.json({ status: "ok", user });
  }

  switch (result.error) {
    case "authorization_pending":
      return NextResponse.json({ status: "pending" });
    case "slow_down":
      return NextResponse.json({ status: "slow_down" });
    case "access_denied":
      jar.delete("device_code");
      return NextResponse.json({ status: "denied" });
    case "expired_token":
      jar.delete("device_code");
      return NextResponse.json({ status: "expired" });
    default:
      return NextResponse.json({ status: "error", reason: result.error });
  }
}
