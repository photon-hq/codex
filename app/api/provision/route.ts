import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { ensureFreshAccessToken, pickDefaultEnvironment } from "@/lib/codex-cloud";
import { encrypt } from "@/lib/crypto";
import {
  SpectrumError,
  checkPhoneAvailability,
  cloudTogglePlatform,
  createProject,
  createSpectrumUser,
  getProject,
  getSession,
  imessageRedirectUrl,
  listProjectUsers,
  listProjects,
  regenerateProjectSecret,
  togglePlatform,
} from "@/lib/spectrum";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

interface PendingTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  account_id?: string | null;
  email?: string | null;
  name?: string | null;
}

export async function POST(req: Request) {
  const jar = await cookies();
  const bearer = jar.get("bearer")?.value;
  if (!bearer) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const pendingRaw = jar.get("codex_pending_tokens")?.value;
  if (!pendingRaw) {
    return NextResponse.json(
      {
        error: "Sign in with ChatGPT before provisioning your iMessage line.",
        reason: "codex_required",
      },
      { status: 400 },
    );
  }

  let pending: PendingTokens;
  try {
    pending = JSON.parse(pendingRaw) as PendingTokens;
  } catch {
    return NextResponse.json(
      { error: "Codex login is corrupted. Sign in again.", reason: "codex_required" },
      { status: 400 },
    );
  }

  let userPhone: string | null = null;

  try {
    const body = (await req.json().catch(() => ({}))) as { userPhone?: unknown };
    if (typeof body.userPhone === "string" && body.userPhone.trim().length > 0) {
      userPhone = body.userPhone.trim();
    }
  } catch {}

  if (!userPhone || !PHONE_RE.test(userPhone)) {
    return NextResponse.json(
      {
        error: "Add your phone number in E.164 format, e.g. +14155550123.",
        reason: "phone_required",
      },
      { status: 422 },
    );
  }

  let freshTokens: Awaited<ReturnType<typeof ensureFreshAccessToken>>;
  try {
    freshTokens = await ensureFreshAccessToken({
      access_token: pending.access_token,
      refresh_token: pending.refresh_token,
      expires_at: pending.expires_at,
    });
  } catch (err) {
    console.warn("[provision] codex token refresh failed:", err);
    return NextResponse.json(
      { error: "Codex login expired. Sign in again.", reason: "codex_required" },
      { status: 401 },
    );
  }

  let codexEnvironmentId: string | null = null;
  try {
    const env = await pickDefaultEnvironment(freshTokens.access_token);
    codexEnvironmentId = env?.id ?? null;
  } catch (err) {
    console.warn("[provision] could not list codex envs (continuing):", err);
  }

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

    let upstreamProjects: Awaited<ReturnType<typeof listProjects>> | null = null;
    let listProjectsErrored = false;
    try {
      upstreamProjects = await listProjects(bearer);
    } catch (err) {
      listProjectsErrored = true;
      console.warn(
        "[provision] list-projects probe failed:",
        err instanceof Error ? err.message : err,
      );
    }

    if (existing.length > 0) {
      const t = existing[0];
      let stillExists = true;
      if (upstreamProjects) {
        stillExists = upstreamProjects.some(
          (p) =>
            (p.spectrumProjectId && p.spectrumProjectId === t.spectrumProjectId) ||
            p.id === t.spectrumProjectId,
        );
      }

      if (stillExists || listProjectsErrored) {
        const refreshBlob = encrypt(freshTokens.refresh_token);
        const accessBlob = encrypt(freshTokens.access_token);
        await db
          .update(tenants)
          .set({
            codexRefreshCiphertext: refreshBlob.ciphertext,
            codexRefreshIv: refreshBlob.iv,
            codexRefreshTag: refreshBlob.tag,
            codexAccessCiphertext: accessBlob.ciphertext,
            codexAccessIv: accessBlob.iv,
            codexAccessTag: accessBlob.tag,
            codexAccessExpiresAt: new Date(freshTokens.expires_at),
            codexAccountId: pending.account_id ?? null,
            codexUserEmail: pending.email ?? null,
            codexEnvironmentId: codexEnvironmentId ?? t.codexEnvironmentId,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, t.id));
        jar.delete("codex_pending_tokens");
        return NextResponse.json({
          status: "existing",
          tenantId: t.id,
          phoneNumber: t.phoneNumber,
          redirectUri: imessageRedirectUrl(t.phoneNumber),
          codexLinked: true,
          codexEnvironmentId: codexEnvironmentId ?? t.codexEnvironmentId,
        });
      }

      console.log(
        `[provision] upstream project gone (${t.spectrumProjectId}); removing stale tenant ${t.id} and re-provisioning`,
      );
      await db.delete(tenants).where(eq(tenants.id, t.id));
    }

    let projectId: string | null = null;
    let reused = false;
    if (upstreamProjects) {
      const ours = upstreamProjects.find(
        (p) =>
          typeof p.name === "string" &&
          p.name.toLowerCase().startsWith("codex ") &&
          p.spectrum !== false,
      );
      if (ours?.id) {
        projectId = ours.id;
        reused = true;
        console.log(`[provision] reusing existing project ${ours.id} (${ours.name})`);
      }
    }

    if (!projectId) {
      try {
        const availability = await checkPhoneAvailability(bearer, userPhone);
        if (!availability.available) {
          return NextResponse.json(
            {
              error:
                "That phone is already registered on Spectrum. Use a phone you haven't used with Spectrum (Google Voice works well).",
              reason: "phone_conflict",
            },
            { status: 409 },
          );
        }
      } catch (err) {
        console.warn(
          "[provision] check-availability failed (continuing):",
          err instanceof Error ? err.message : err,
        );
      }

      const projectName = session.user.email
        ? `codex (${session.user.email})`
        : `codex (${session.user.id.slice(0, 8)})`;
      const created = await createProject(bearer, { name: projectName, spectrum: true });
      projectId = created.id;
    }

    const { projectSecret } = await regenerateProjectSecret(bearer, projectId);
    await togglePlatform(bearer, projectId, "imessage", true);

    const details = await getProject(bearer, projectId);
    const cloudProjectId = details.spectrumProjectId ?? projectId;
    console.log(
      `[provision] dashboard=${projectId} cloud=${details.spectrumProjectId ?? "(missing)"} reused=${reused}`,
    );

    let toggled = false;
    for (let attempt = 1; attempt <= 4 && !toggled; attempt += 1) {
      try {
        await cloudTogglePlatform(cloudProjectId, projectSecret, "imessage", true);
        toggled = true;
      } catch (err) {
        const is401 = err instanceof SpectrumError && err.status === 401;
        if (!is401 || attempt === 4) {
          console.warn(
            "[provision] cloud iMessage toggle failed (non-fatal):",
            err instanceof Error ? err.message : err,
          );
          break;
        }
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }

    let assigned: string | undefined;
    let spectrumUserRecordId: string | undefined;
    try {
      const userResp = await createSpectrumUser(bearer, projectId, {
        phoneNumber: userPhone,
      });
      assigned = userResp.user?.assignedPhoneNumber?.trim();
      spectrumUserRecordId = userResp.user?.id;
    } catch (err) {
      if (!(err instanceof SpectrumError) || err.status !== 409 || !reused) throw err;
      console.warn("[provision] create-user conflict on reused project, finding existing user");
      const users = await listProjectUsers(cloudProjectId, projectSecret).catch(() => []);
      const match = users.find((u) => u.phoneNumber && u.phoneNumber === userPhone);
      if (!match?.assignedPhoneNumber) throw err;
      assigned = match.assignedPhoneNumber.trim();
      spectrumUserRecordId = match.id;
    }

    if (!assigned || !PHONE_RE.test(assigned)) {
      throw new SpectrumError("Spectrum didn't return an assigned iMessage number.", 500, {
        projectId,
        cloudProjectId,
      });
    }

    const projectSecretBlob = encrypt(projectSecret);
    const refreshBlob = encrypt(freshTokens.refresh_token);
    const accessBlob = encrypt(freshTokens.access_token);

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
        spectrumLineId: spectrumUserRecordId ?? `${cloudProjectId}:imessage`,
        phoneNumber: assigned,
        codexRefreshCiphertext: refreshBlob.ciphertext,
        codexRefreshIv: refreshBlob.iv,
        codexRefreshTag: refreshBlob.tag,
        codexAccessCiphertext: accessBlob.ciphertext,
        codexAccessIv: accessBlob.iv,
        codexAccessTag: accessBlob.tag,
        codexAccessExpiresAt: new Date(freshTokens.expires_at),
        codexAccountId: pending.account_id ?? null,
        codexUserEmail: pending.email ?? null,
        codexEnvironmentId,
        codexModel: process.env.CODEX_MODEL ?? "gpt-5-codex",
      })
      .returning();

    jar.delete("codex_pending_tokens");

    return NextResponse.json({
      status: "created",
      tenantId: row.id,
      phoneNumber: row.phoneNumber,
      redirectUri: imessageRedirectUrl(row.phoneNumber),
      codexLinked: true,
      codexEnvironmentId,
    });
  } catch (err) {
    console.error("[provision] failed", err);
    if (err instanceof SpectrumError) {
      if (err.status === 403) {
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
      if (err.status === 409) {
        return NextResponse.json(
          {
            error:
              "That phone is already on a Spectrum account. Use a phone you haven't registered with Spectrum (e.g. a Google Voice number).",
            reason: "phone_conflict",
          },
          { status: 409 },
        );
      }
    }
    const message = err instanceof Error ? err.message : "provision failed";
    const status = err instanceof SpectrumError ? err.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
