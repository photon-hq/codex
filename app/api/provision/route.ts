import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { isOpenAIKeyShape, verifyOpenAIKey } from "@/lib/openai-key";
import {
  SpectrumError,
  createProject,
  createSpectrumUser,
  getProject,
  getSession,
  imessageRedirectUrl,
  provisionImessage,
  regenerateProjectSecret,
  togglePlatform,
} from "@/lib/spectrum";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHONE_RE = /^\+?\d{6,}$/;
const PREFERRED_PHONE_KEYS = [
  "assignedPhoneNumber",
  "botPhoneNumber",
  "spectrumPhoneNumber",
  "inboundPhoneNumber",
  "sharedPhoneNumber",
  "lineNumber",
];
const FALLBACK_PHONE_KEYS = ["phoneNumber", "phone", "number", "msisdn"];

function pickPhoneFrom(value: unknown, exclude?: string | null, depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = pickPhoneFrom(item, exclude, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  for (const key of PREFERRED_PHONE_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && PHONE_RE.test(v.trim())) {
      const trimmed = v.trim();
      if (!exclude || trimmed !== exclude) return trimmed;
    }
  }
  for (const key of FALLBACK_PHONE_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && PHONE_RE.test(v.trim())) {
      const trimmed = v.trim();
      if (!exclude || trimmed !== exclude) return trimmed;
    }
  }
  for (const v of Object.values(obj)) {
    const hit = pickPhoneFrom(v, exclude, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export async function POST(req: Request) {
  const jar = await cookies();
  const bearer = jar.get("bearer")?.value;
  if (!bearer) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let openaiKey: string | null = null;
  let userPhone: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      openaiKey?: unknown;
      userPhone?: unknown;
    };
    if (typeof body.userPhone === "string" && body.userPhone.trim().length > 0) {
      userPhone = body.userPhone.trim();
    }
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
    console.log("[provision] session.user keys:", Object.keys(session.user));

    const ownerPhone =
      userPhone ?? (typeof session.user.phoneNumber === "string" ? session.user.phoneNumber : null);

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

    const details = await getProject(bearer, project.id);
    const cloudProjectId = details.spectrumProjectId ?? project.id;
    console.log(
      `[provision] dashboard id=${project.id} cloud spectrumProjectId=${details.spectrumProjectId ?? "(missing — using dashboard id)"}`,
    );

    if (!ownerPhone) {
      return NextResponse.json(
        {
          error:
            "We need your phone number to assign you a Spectrum iMessage bot. Add it and continue.",
          reason: "phone_required",
        },
        { status: 422 },
      );
    }

    const fullName = session.user.name?.trim() ?? "";
    const [firstName, ...rest] = fullName.split(/\s+/);
    const userResp = await createSpectrumUser(bearer, project.id, {
      firstName: firstName || "Codex",
      lastName: rest.join(" ") || "User",
      email: session.user.email ?? `${session.user.id}@codex.local`,
      phoneNumber: ownerPhone,
      sendInvite: false,
    });
    console.log("[provision] create-spectrum-user response:", JSON.stringify(userResp));

    let line = await provisionImessage(bearer, cloudProjectId, projectSecret).catch(
      (err: unknown) => {
        console.warn(
          "[provision] provisionImessage fallback after user-add:",
          err instanceof Error ? err.message : err,
        );
        return null;
      },
    );

    if (!line) {
      const fromUser = pickPhoneFrom(userResp, ownerPhone);
      if (fromUser) {
        line = { id: userResp.user?.id ?? `${cloudProjectId}:imessage`, phoneNumber: fromUser };
      } else {
        throw new SpectrumError(
          "Couldn't read the assigned iMessage number from Spectrum's response.",
          500,
          userResp,
        );
      }
    }

    const projectSecretBlob = encrypt(projectSecret);
    const openaiBlob = openaiKey ? encrypt(openaiKey) : null;

    const [row] = await db
      .insert(tenants)
      .values({
        spectrumUserId: session.user.id,
        spectrumEmail: session.user.email ?? null,
        spectrumUserName: session.user.name ?? null,
        spectrumProjectId: cloudProjectId,
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
