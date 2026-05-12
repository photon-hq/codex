import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { isOpenAIKeyShape, verifyOpenAIKey } from "@/lib/openai-key";
import {
  SpectrumError,
  createProject,
  ensureImessageLine,
  getSession,
  imessageRedirectUrl,
  regenerateProjectSecret,
  togglePlatform,
} from "@/lib/spectrum";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await cookies();
  const bearer = jar.get("bearer")?.value;
  if (!bearer) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let openaiKey: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { openaiKey?: unknown };
    if (typeof body.openaiKey === "string" && body.openaiKey.trim().length > 0) {
      const candidate = body.openaiKey.trim();
      if (!isOpenAIKeyShape(candidate)) {
        return NextResponse.json(
          {
            error:
              "That doesn't look like an OpenAI API key. It should start with sk- and be at least 40 characters.",
            reason: "bad_shape",
          },
          { status: 400 },
        );
      }
      const verdict = await verifyOpenAIKey(candidate);
      if (!verdict.ok) {
        return NextResponse.json(
          { error: verdict.message, reason: verdict.reason },
          { status: verdict.reason === "network_error" ? 502 : 400 },
        );
      }
      openaiKey = candidate;
    }
  } catch {}

  try {
    const session = await getSession(bearer);
    if (!session) {
      return NextResponse.json({ error: "session invalid" }, { status: 401 });
    }

    const db = getDb();

    const existing = await db
      .select()
      .from(tenants)
      .where(eq(tenants.spectrumUserId, session.user.id))
      .limit(1);
    if (existing.length > 0) {
      const t = existing[0];
      return NextResponse.json({
        status: "existing",
        tenantId: t.id,
        phoneNumber: t.phoneNumber,
        redirectUri: imessageRedirectUrl(t.phoneNumber),
        hasOpenAIKey: !!t.openaiKeyCiphertext,
      });
    }

    const projectName = session.user.email
      ? `codex (${session.user.email})`
      : `codex (${session.user.id.slice(0, 8)})`;

    const project = await createProject(bearer, {
      name: projectName,
      spectrum: true,
    });

    const { projectSecret } = await regenerateProjectSecret(bearer, project.id);

    await togglePlatform(bearer, project.id, "imessage", true);

    const line = await ensureImessageLine(bearer, project.id);

    const projectSecretBlob = encrypt(projectSecret);
    const openaiBlob = openaiKey ? encrypt(openaiKey) : null;

    const [row] = await db
      .insert(tenants)
      .values({
        spectrumUserId: session.user.id,
        spectrumEmail: session.user.email ?? null,
        spectrumUserName: session.user.name ?? null,
        spectrumProjectId: project.id,
        spectrumProjectSecretCiphertext: projectSecretBlob.ciphertext,
        spectrumProjectSecretIv: projectSecretBlob.iv,
        spectrumProjectSecretTag: projectSecretBlob.tag,
        spectrumLineId: line.id,
        phoneNumber: line.phoneNumber,
        openaiKeyCiphertext: openaiBlob?.ciphertext ?? null,
        openaiKeyIv: openaiBlob?.iv ?? null,
        openaiKeyTag: openaiBlob?.tag ?? null,
        codexModel: process.env.CODEX_MODEL ?? "gpt-5-codex",
      })
      .returning();

    return NextResponse.json({
      status: "created",
      tenantId: row.id,
      phoneNumber: row.phoneNumber,
      redirectUri: imessageRedirectUrl(row.phoneNumber),
      hasOpenAIKey: !!openaiBlob,
    });
  } catch (err) {
    console.error("[provision] failed", err);
    if (err instanceof SpectrumError && err.status === 403) {
      return NextResponse.json(
        {
          error:
            "Your Spectrum project needs the Business plan to add an iMessage line. Upgrade in the Spectrum dashboard and retry.",
          reason: "plan_required",
          billingUrl: `${process.env.SPECTRUM_API_HOST ?? "https://app.photon.codes"}/billing`,
        },
        { status: 402 },
      );
    }
    const status = err instanceof SpectrumError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "provision failed" },
      { status },
    );
  }
}
