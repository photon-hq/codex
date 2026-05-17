import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { TENANT_STATUS, tenants } from "@/db/schema";
import {
  ensureFreshAccessToken,
  isGithubLinkMissingError,
  isMfaRequiredError,
  pickDefaultEnvironment,
} from "@/lib/codex-cloud";
import { encrypt } from "@/lib/crypto";
import {
  checkPhoneAvailability,
  cloudCreateUser,
  cloudTogglePlatform,
  createProject,
  getProject,
  getSession,
  imessageRedirectUrl,
  listProjects,
  listProjectUsers,
  regenerateProjectSecret,
  SpectrumError,
  togglePlatform,
} from "@/lib/spectrum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

interface PendingTokens {
  access_token: string;
  account_id?: string | null;
  email?: string | null;
  expires_at: number;
  name?: string | null;
  refresh_token: string;
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
      { status: 400 }
    );
  }

  let pending: PendingTokens;
  try {
    pending = JSON.parse(pendingRaw) as PendingTokens;
  } catch {
    return NextResponse.json(
      { error: "Codex login is corrupted. Sign in again.", reason: "codex_required" },
      { status: 400 }
    );
  }

  let userPhone: string | null = null;

  try {
    const body = (await req.json().catch(() => ({}))) as { userPhone?: unknown };
    if (typeof body.userPhone === "string" && body.userPhone.trim().length > 0) {
      userPhone = body.userPhone.trim();
    }
  } catch {}

  if (!(userPhone && PHONE_RE.test(userPhone))) {
    return NextResponse.json(
      {
        error: "Add your phone number in E.164 format, e.g. +14155550123.",
        reason: "phone_required",
      },
      { status: 422 }
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
      { status: 401 }
    );
  }

  let codexEnvironmentId: string | null = null;
  try {
    const env = await pickDefaultEnvironment(freshTokens.access_token);
    codexEnvironmentId = env?.id ?? null;
  } catch (err) {
    if (isMfaRequiredError(err)) {
      console.warn(
        "[provision] codex MFA-required during pre-flight env probe — blocking onboarding"
      );
      // Keep `codex_pending_tokens` so the user can retry after fixing settings.
      return NextResponse.json(
        {
          error:
            "Codex requires multi-factor authentication on this ChatGPT account. " +
            "Open chatgpt.com → Settings → Security and (1) enable multi-factor " +
            "authentication, then (2) enable “Sign in with device code”. After " +
            "that, re-link Codex below. If your account belongs to a ChatGPT " +
            "workspace, an admin may also need to allow device-code login.",
          reason: "mfa_required",
          chatgptSecurityUrl: "https://chatgpt.com/#settings/Security",
        },
        { status: 403 }
      );
    }
    if (isGithubLinkMissingError(err)) {
      console.warn(
        "[provision] codex GitHub-not-linked during pre-flight env probe — blocking onboarding"
      );
      return NextResponse.json(
        {
          error:
            "Codex needs GitHub connected before it can run tasks. Open " +
            "chatgpt.com → Codex and connect your GitHub account, then come " +
            "back and re-link Codex below.",
          reason: "github_required",
          codexEnvironmentsUrl: "https://chatgpt.com/codex/settings/environments",
        },
        { status: 412 }
      );
    }
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
        err instanceof Error ? err.message : err
      );
    }

    console.log(
      `[provision] user=${session.user.id} existingTenants=${existing.length} ` +
        `upstreamProjects=${upstreamProjects ? upstreamProjects.length : "errored"}`
    );

    if (existing.length > 0) {
      const t = existing[0];
      let stillExists = true;
      if (upstreamProjects) {
        stillExists = upstreamProjects.some(
          (p) =>
            (p.spectrumProjectId && p.spectrumProjectId === t.spectrumProjectId) ||
            p.id === t.spectrumProjectId
        );
        if (!stillExists) {
          const upstreamIds = upstreamProjects
            .map((p) => `${p.id}${p.spectrumProjectId ? `(spId=${p.spectrumProjectId})` : ""}`)
            .join(",");
          console.warn(
            `[provision] existing tenant ${t.id} references project ${t.spectrumProjectId} ` +
              `but upstream returned: ${upstreamIds || "(empty list)"}`
          );
        }
      }
      console.log(
        `[provision] existing tenant ${t.id} (${t.phoneNumber}) project=${t.spectrumProjectId} ` +
          `stillExists=${stillExists} listProjectsErrored=${listProjectsErrored} ` +
          `→ ${stillExists || listProjectsErrored ? "KEEP" : "DELETE+RE-PROVISION"}`
      );

      if (stillExists || listProjectsErrored) {
        const refreshBlob = encrypt(freshTokens.refresh_token);
        const accessBlob = encrypt(freshTokens.access_token);
        if (t.status === TENANT_STATUS.NEEDS_RELINK) {
          console.log(
            `[provision] tenant ${t.id} clearing needs_relink — fresh tokens landed via device-auth`
          );
        }
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
            // Re-link path always returns to PROVISIONED. Even if the new
            // token also turns out to be bad, the worker will re-mark on
            // its next refresh attempt — but the common case is recovery.
            status: TENANT_STATUS.PROVISIONED,
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
        `[provision] upstream project gone (${t.spectrumProjectId}); removing stale tenant ${t.id} and re-provisioning`
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
          p.spectrum !== false
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
            { status: 409 }
          );
        }
      } catch (err) {
        console.warn(
          "[provision] check-availability failed (continuing):",
          err instanceof Error ? err.message : err
        );
      }

      const projectName = session.user.email
        ? `codex (${session.user.email})`
        : `codex (${session.user.id.slice(0, 8)})`;
      const created = await createProject(bearer, { name: projectName, spectrum: true });
      projectId = created.id;
    }

    await togglePlatform(bearer, projectId, "imessage", true);

    const details = await getProject(bearer, projectId);
    const cloudProjectId = details.spectrumProjectId ?? null;
    if (!cloudProjectId) {
      throw new SpectrumError(
        "Spectrum project is missing a spectrumProjectId; cannot reach the cloud API.",
        500,
        { projectId }
      );
    }

    let projectSecret = typeof details.projectSecret === "string" ? details.projectSecret : null;
    if (!projectSecret) {
      const rotated = await regenerateProjectSecret(bearer, projectId);
      projectSecret = rotated.projectSecret;
    }

    console.log(`[provision] dashboard=${projectId} cloud=${cloudProjectId} reused=${reused}`);

    await cloudTogglePlatform(cloudProjectId, projectSecret, "imessage", true);

    let assigned: string | undefined;
    let spectrumUserRecordId: string | undefined;
    try {
      const user = await cloudCreateUser(cloudProjectId, projectSecret, {
        phoneNumber: userPhone,
      });
      assigned = user.assignedPhoneNumber?.trim();
      spectrumUserRecordId = user.id;
    } catch (err) {
      if (!(err instanceof SpectrumError) || err.status !== 409 || !reused) {
        throw err;
      }
      console.warn("[provision] create-user conflict on reused project, finding existing user");
      const users = await listProjectUsers(cloudProjectId, projectSecret).catch(() => []);
      const match = users.find((u) => u.phoneNumber && u.phoneNumber === userPhone);
      if (!match?.assignedPhoneNumber) {
        throw err;
      }
      assigned = match.assignedPhoneNumber.trim();
      spectrumUserRecordId = match.id;
    }

    if (!(assigned && PHONE_RE.test(assigned))) {
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
      })
      .returning();

    jar.delete("codex_pending_tokens");

    console.log(
      `[provision] inserted tenant ${row.id} (${row.phoneNumber}) project=${row.spectrumProjectId} ` +
        `— bridge will pick up on next sync (≤${process.env.BRIDGE_POLL_INTERVAL_MS ?? "10000"}ms)`
    );

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
          { status: 402 }
        );
      }
      if (err.status === 409) {
        return NextResponse.json(
          {
            error:
              "That phone is already on a Spectrum account. Use a phone you haven't registered with Spectrum (e.g. a Google Voice number).",
            reason: "phone_conflict",
          },
          { status: 409 }
        );
      }
    }
    const message = err instanceof Error ? err.message : "provision failed";
    const status = err instanceof SpectrumError ? err.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
