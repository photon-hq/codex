import { SpectrumError, startDeviceFlow } from "@/lib/spectrum";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const flow = await startDeviceFlow();
    const jar = await cookies();
    jar.set("device_code", flow.device_code, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: flow.expires_in,
    });
    return NextResponse.json({
      user_code: flow.user_code,
      verification_uri: flow.verification_uri,
      verification_uri_complete: flow.verification_uri_complete ?? null,
      interval: flow.interval,
      expires_in: flow.expires_in,
    });
  } catch (err) {
    console.error("[oauth/device/start] failed:", err);
    const status = err instanceof SpectrumError ? err.status : 500;
    const cause =
      err instanceof Error && "cause" in err && err.cause instanceof Error
        ? ` (${err.cause.message})`
        : "";
    const host = process.env.SPECTRUM_API_HOST ?? "<unset>";
    return NextResponse.json(
      {
        error:
          err instanceof SpectrumError ? err.message : `Couldn't reach Spectrum at ${host}${cause}`,
      },
      { status },
    );
  }
}
