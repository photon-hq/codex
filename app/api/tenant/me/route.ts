import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { getSession, imessageRedirectUrl } from "@/lib/spectrum";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const bearer = jar.get("bearer")?.value;
  if (!bearer) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const session = await getSession(bearer);
  if (!session) return NextResponse.json({ error: "session invalid" }, { status: 401 });

  const db = getDb();
  const [row] = await db
    .select({
      id: tenants.id,
      spectrumEmail: tenants.spectrumEmail,
      spectrumUserName: tenants.spectrumUserName,
      phoneNumber: tenants.phoneNumber,
      codexUserEmail: tenants.codexUserEmail,
      codexAccountId: tenants.codexAccountId,
      codexEnvironmentId: tenants.codexEnvironmentId,
      codexEnvironmentBranch: tenants.codexEnvironmentBranch,
      codexLinked: tenants.codexRefreshCiphertext,
      status: tenants.status,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .where(eq(tenants.spectrumUserId, session.user.id))
    .limit(1);

  if (!row) return NextResponse.json({ provisioned: false, user: session.user });

  return NextResponse.json({
    provisioned: true,
    user: session.user,
    tenant: {
      ...row,
      redirectUri: imessageRedirectUrl(row.phoneNumber),
      codexLinked: !!row.codexLinked,
    },
  });
}
