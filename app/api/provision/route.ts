import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { isOpenAIKeyShape, verifyOpenAIKey } from "@/lib/openai-key";
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
  setSpectrumProfile,
  togglePlatform,
} from "@/lib/spectrum";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

export async function POST(req: Request) {
  const jar = await cookies();
  const bearer = jar.get("bearer")?.value;
  if (!bearer) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let openaiKey: string | null = null;
  let userPhone: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      openaiKey?: unknown;
      userPhone?: unknown;
      firstName?: unknown;
      lastName?: unknown;
    };
    if (typeof body.userPhone === "string" && body.userPhone.trim().length > 0) {
      userPhone = body.userPhone.trim();
    }
    if (typeof body.firstName === "string" && body.firstName.trim().length > 0) {
      firstName = body.firstName.trim();
    }
    if (typeof body.lastName === "string" && body.lastName.trim().length > 0) {
      lastName = body.lastName.trim();
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

  if (!userPhone || !PHONE_RE.test(userPhone)) {
    return NextResponse.json(
      {
        error: "Add your phone number in E.164 format, e.g. +14155550123.",
        reason: "phone_required",
      },
      { status: 422 },
    );
  }
  if (!firstName || !lastName) {
    return NextResponse.json(
      { error: "First and last name are required.", reason: "name_required" },
      { status: 422 },
    );
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
        return NextResponse.json({
          status: "existing",
          tenantId: t.id,
          phoneNumber: t.phoneNumber,
          redirectUri: imessageRedirectUrl(t.phoneNumber),
          hasOpenAIKey: !!t.openaiKeyCiphertext,
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

    try {
      await cloudTogglePlatform(cloudProjectId, projectSecret, "imessage", true);
    } catch (err) {
      console.warn(
        "[provision] cloud iMessage toggle failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    }

    await setSpectrumProfile(bearer, projectId, { firstName, lastName });

    const ownerEmail = session.user.email ?? `${session.user.id}@codex.local`;

    let assigned: string | undefined;
    let spectrumUserRecordId: string | undefined;
    try {
      const userResp = await createSpectrumUser(bearer, projectId, {
        firstName,
        lastName,
        email: ownerEmail,
        phoneNumber: userPhone,
        sendInvite: false,
      });
      assigned = userResp.user?.assignedPhoneNumber?.trim();
      spectrumUserRecordId = userResp.user?.id;
    } catch (err) {
      if (!(err instanceof SpectrumError) || err.status !== 409 || !reused) throw err;
      console.warn("[provision] create-user conflict on reused project, finding existing user");
      const users = await listProjectUsers(cloudProjectId, projectSecret).catch(() => []);
      const lowerEmail = ownerEmail.toLowerCase();
      const match = users.find(
        (u) =>
          (u.phoneNumber && u.phoneNumber === userPhone) ||
          (u.email && u.email.toLowerCase() === lowerEmail),
      );
      if (!match?.assignedPhoneNumber) throw err;
      assigned = match.assignedPhoneNumber.trim();
      spectrumUserRecordId = match.id;
    }

    if (!assigned || !PHONE_RE.test(assigned)) {
      throw new SpectrumError(
        "Spectrum didn't return an assigned iMessage number.",
        500,
        { projectId, cloudProjectId },
      );
    }

    const projectSecretBlob = encrypt(projectSecret);
    const openaiBlob = openaiKey ? encrypt(openaiKey) : null;

    const [row] = await db
      .insert(tenants)
      .values({
        spectrumUserId: session.user.id,
        spectrumEmail: session.user.email ?? null,
        spectrumUserName: `${firstName} ${lastName}`.trim(),
        spectrumProjectId: cloudProjectId,
        spectrumProjectSecretCiphertext: projectSecretBlob.ciphertext,
        spectrumProjectSecretIv: projectSecretBlob.iv,
        spectrumProjectSecretTag: projectSecretBlob.tag,
        spectrumLineId: spectrumUserRecordId ?? `${cloudProjectId}:imessage`,
        phoneNumber: assigned,
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
