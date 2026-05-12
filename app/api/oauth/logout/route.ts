import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  jar.delete("bearer");
  jar.delete("device_code");
  return NextResponse.json({ status: "ok" });
}
