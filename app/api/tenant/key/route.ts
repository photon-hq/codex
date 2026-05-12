import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import {
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
  OPENAI_KEY_PATTERN,
  verifyOpenAIKey,
} from "@/lib/openai-key";
import { getSession } from "@/lib/spectrum";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(MIN_KEY_LENGTH, "Key looks too short.")
    .max(MAX_KEY_LENGTH, "Key looks too long.")
    .regex(OPENAI_KEY_PATTERN, "Key should start with sk- and contain only [A-Za-z0-9_-]."),
});

export async function POST(req: Request) {
  const jar = await cookies();
  const bearer = jar.get("bearer")?.value;
  if (!bearer) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (err) {
    const message =
      err instanceof z.ZodError ? (err.issues[0]?.message ?? "invalid body") : "invalid body";
    return NextResponse.json({ error: message, reason: "bad_shape" }, { status: 400 });
  }

  const session = await getSession(bearer);
  if (!session) return NextResponse.json({ error: "session invalid" }, { status: 401 });

  const verdict = await verifyOpenAIKey(parsed.apiKey);
  if (!verdict.ok) {
    return NextResponse.json(
      { error: verdict.message, reason: verdict.reason },
      { status: verdict.reason === "network_error" ? 502 : 400 },
    );
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(tenants)
    .where(eq(tenants.spectrumUserId, session.user.id))
    .limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "no provisioned tenant" }, { status: 404 });
  }

  const blob = encrypt(parsed.apiKey);
  await db
    .update(tenants)
    .set({
      openaiKeyCiphertext: blob.ciphertext,
      openaiKeyIv: blob.iv,
      openaiKeyTag: blob.tag,
      previousResponseId: null,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, existing[0].id));

  return NextResponse.json({ status: "ok" });
}

export async function DELETE() {
  const jar = await cookies();
  const bearer = jar.get("bearer")?.value;
  if (!bearer) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const session = await getSession(bearer);
  if (!session) return NextResponse.json({ error: "session invalid" }, { status: 401 });

  const db = getDb();
  await db
    .update(tenants)
    .set({
      openaiKeyCiphertext: null,
      openaiKeyIv: null,
      openaiKeyTag: null,
      updatedAt: new Date(),
    })
    .where(eq(tenants.spectrumUserId, session.user.id));

  return NextResponse.json({ status: "ok" });
}
