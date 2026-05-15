import { getDb } from "@/db/client";
import { events, codexThreads, tenants } from "@/db/schema";
import { getSession } from "@/lib/spectrum";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  const bearer = jar.get("bearer")?.value;
  if (!bearer) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const session = await getSession(bearer);
  if (!session) return NextResponse.json({ error: "session invalid" }, { status: 401 });

  const db = getDb();
  const [row] = await db
    .select({ id: tenants.id, phoneNumber: tenants.phoneNumber })
    .from(tenants)
    .where(eq(tenants.spectrumUserId, session.user.id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ status: "noop", message: "no tenant to disconnect" });
  }

  await db.delete(codexThreads).where(eq(codexThreads.tenantId, row.id));
  await db.delete(events).where(eq(events.tenantId, row.id));
  await db.delete(tenants).where(eq(tenants.id, row.id));

  jar.delete("codex_pending_tokens");
  jar.delete("codex_device_auth_id");
  jar.delete("codex_user_code");

  console.log(`[disconnect] removed tenant ${row.id} (${row.phoneNumber})`);

  return NextResponse.json({
    status: "ok",
    removedPhoneNumber: row.phoneNumber,
    note: "Spectrum project not auto-deleted — re-onboarding will reuse it.",
  });
}
