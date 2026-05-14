function dashboardHost() {
  const h = process.env.SPECTRUM_API_HOST;
  if (!h) throw new Error("SPECTRUM_API_HOST is not set");
  return h.replace(/\/+$/, "");
}

function runtimeHost() {
  const h = process.env.SPECTRUM_RUNTIME_HOST ?? "https://spectrum.photon.codes";
  return h.replace(/\/+$/, "");
}

function basicAuth(projectId: string, projectSecret: string): string {
  return `Basic ${Buffer.from(`${projectId}:${projectSecret}`).toString("base64")}`;
}

function clientId() {
  const c = process.env.SPECTRUM_CLIENT_ID;
  if (!c) throw new Error("SPECTRUM_CLIENT_ID is not set");
  return c;
}

export class SpectrumError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "SpectrumError";
  }
}

async function asJson(res: Response): Promise<unknown> {
  const txt = await res.text();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

async function expectOk<T>(res: Response, context: string): Promise<T> {
  if (!res.ok) {
    const body = await asJson(res);
    let hint = "";
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      const desc = typeof b.error_description === "string" ? b.error_description : null;
      const code = typeof b.error === "string" ? b.error : null;
      hint = desc ?? code ?? "";
    } else if (typeof body === "string" && body.length > 0 && body.length < 200) {
      hint = body;
    }
    const suffix = hint ? ` — ${hint}` : "";
    throw new SpectrumError(
      `${context} failed: ${res.status} ${res.statusText}${suffix}`,
      res.status,
      body,
    );
  }
  return (await asJson(res)) as T;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval: number;
  expires_in: number;
}

export interface DeviceTokenSuccess {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export type DeviceTokenError =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unsupported_grant_type";

export interface DeviceTokenPending {
  error: DeviceTokenError;
  error_description?: string;
}

export type DeviceTokenResult =
  | { ok: true; token: DeviceTokenSuccess }
  | { ok: false; error: DeviceTokenError; status: number };

export async function startDeviceFlow(scope = "openid profile email"): Promise<DeviceCodeResponse> {
  const res = await fetch(`${dashboardHost()}/api/auth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId(), scope }),
  });
  return expectOk<DeviceCodeResponse>(res, "device/code");
}

export async function pollDeviceToken(deviceCode: string): Promise<DeviceTokenResult> {
  // Spectrum's device-token endpoint requires JSON, not form-urlencoded.
  const res = await fetch(`${dashboardHost()}/api/auth/device/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: clientId(),
    }),
  });
  const body = await asJson(res);
  if (res.ok && body && typeof body === "object" && "access_token" in body) {
    return { ok: true, token: body as DeviceTokenSuccess };
  }
  const err =
    body && typeof body === "object" && "error" in body
      ? (body as DeviceTokenPending).error
      : "invalid_request";
  return { ok: false, error: err, status: res.status };
}

export interface SessionUser {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  phoneNumber?: string | null;
  [key: string]: unknown;
}

interface RawSessionEnvelope {
  user?: Partial<SessionUser> & Record<string, unknown>;
  session?: { userId?: string; id?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export async function getSession(bearer: string): Promise<{ user: SessionUser } | null> {
  const res = await fetch(`${dashboardHost()}/api/auth/get-session`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  if (res.status === 401) return null;
  const body = (await expectOk<RawSessionEnvelope>(res, "get-session")) ?? {};
  const rawUser = body.user;
  if (!rawUser) return null;

  const id =
    (typeof rawUser.id === "string" && rawUser.id) ||
    (typeof body.session?.userId === "string" && body.session.userId) ||
    (typeof body.session?.id === "string" && body.session.id) ||
    null;

  if (!id) {
    console.warn("[spectrum] get-session returned user without id; body:", JSON.stringify(body));
    return null;
  }

  return {
    user: {
      ...(rawUser as Record<string, unknown>),
      id,
    } as SessionUser,
  };
}

export async function checkPhoneAvailability(
  bearer: string,
  phoneNumber: string,
): Promise<{ available: boolean }> {
  const res = await fetch(
    `${dashboardHost()}/api/projects/check-availability?phoneNumber=${encodeURIComponent(phoneNumber)}`,
    { headers: { authorization: `Bearer ${bearer}` } },
  );
  const body = await expectOk<{ available?: boolean }>(res, "check-phone-availability");
  return { available: !!body?.available };
}

export interface SpectrumUserResult {
  user?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    assignedPhoneNumber?: string | null;
    type?: string | null;
    [key: string]: unknown;
  };
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function createSpectrumUser(
  bearer: string,
  projectId: string,
  input: {
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    sendInvite?: boolean;
  },
): Promise<SpectrumUserResult> {
  const payload = {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phoneNumber: input.phoneNumber,
    sendInvite: input.sendInvite ?? false,
  };
  const res = await fetch(
    `${dashboardHost()}/api/projects/${encodeURIComponent(projectId)}/spectrum/users`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const raw = (await asJson(res)) as unknown;
    throw new SpectrumError(
      `create-spectrum-user failed: ${res.status} ${res.statusText}`,
      res.status,
      raw,
    );
  }
  const body = (await asJson(res)) as SpectrumUserResult | null;
  if (body?.error) {
    if (/failed to create user/i.test(body.error)) {
      throw new SpectrumError(body.error, 409, body);
    }
    throw new SpectrumError(body.error, 500, body);
  }
  return body ?? {};
}

export async function setSpectrumProfile(
  bearer: string,
  projectId: string,
  input: { firstName?: string; lastName?: string; avatarUrl?: string },
): Promise<Record<string, unknown> | null> {
  const body: Record<string, string> = {};
  if (input.firstName) body.firstName = input.firstName;
  if (input.lastName) body.lastName = input.lastName;
  if (input.avatarUrl) body.avatarUrl = input.avatarUrl;
  if (Object.keys(body).length === 0) return null;
  try {
    const res = await fetch(
      `${dashboardHost()}/api/projects/${encodeURIComponent(projectId)}/spectrum/profile`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      console.warn(`[spectrum] set-profile non-ok: ${res.status} ${res.statusText}`);
      return null;
    }
    return (await asJson(res)) as Record<string, unknown> | null;
  } catch (err) {
    console.warn("[spectrum] set-profile failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface CreateProjectInput {
  name: string;
  location?: string;
  spectrum?: boolean;
  template?: boolean;
  observability?: boolean;
}

export interface CreateProjectResult {
  success?: true;
  id?: string;
  spectrumProjectId?: string;
  error?: string;
}

export async function createProject(
  bearer: string,
  input: CreateProjectInput,
): Promise<{ id: string }> {
  const res = await fetch(`${dashboardHost()}/api/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      name: input.name,
      location: input.location ?? "United States",
      spectrum: input.spectrum ?? true,
      template: input.template ?? false,
      observability: input.observability ?? false,
    }),
  });
  const body = await expectOk<CreateProjectResult>(res, "create-project");
  if (!body?.id) throw new SpectrumError("create-project returned no id", 500, body);
  return { id: body.id };
}

export interface ProjectDetails {
  id: string;
  name?: string;
  spectrum?: boolean;
  spectrumProjectId?: string | null;
  [key: string]: unknown;
}

export async function getProject(bearer: string, projectId: string): Promise<ProjectDetails> {
  const res = await fetch(`${dashboardHost()}/api/projects/${encodeURIComponent(projectId)}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  return expectOk<ProjectDetails>(res, "get-project");
}

export async function listProjects(bearer: string): Promise<ProjectDetails[]> {
  let res: Response;
  try {
    res = await fetch(`${dashboardHost()}/api/projects`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
  } catch (err) {
    console.warn("[spectrum] list-projects network error:", err instanceof Error ? err.message : err);
    return [];
  }
  if (!res.ok) {
    console.warn(`[spectrum] list-projects non-ok: ${res.status} ${res.statusText}`);
    return [];
  }
  const body = (await asJson(res)) as unknown;
  if (Array.isArray(body)) return body as ProjectDetails[];
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.projects)) return b.projects as ProjectDetails[];
    if (Array.isArray(b.data)) return b.data as ProjectDetails[];
  }
  return [];
}

export interface RegenerateSecretResult {
  success?: true;
  projectSecret?: string;
  error?: string;
}

export async function regenerateProjectSecret(
  bearer: string,
  projectId: string,
): Promise<{ projectSecret: string }> {
  const res = await fetch(
    `${dashboardHost()}/api/projects/${encodeURIComponent(projectId)}/regenerate-secret`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
    },
  );
  const body = await expectOk<RegenerateSecretResult>(res, "regenerate-secret");
  if (!body?.projectSecret) {
    throw new SpectrumError("regenerate-secret returned no projectSecret", 500, body);
  }
  return { projectSecret: body.projectSecret };
}

export async function togglePlatform(
  bearer: string,
  projectId: string,
  platformId: string,
  enabled: boolean,
): Promise<void> {
  const res = await fetch(
    `${dashboardHost()}/api/projects/${encodeURIComponent(projectId)}/platforms/toggle`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ platformId, enabled }),
    },
  );
  await expectOk(res, `toggle-platform(${platformId}, ${enabled})`);
}

export interface ImessageTokensResponse {
  type: "shared" | "dedicated";
  token?: string;
  auth?: Record<string, string>;
  numbers?: Record<string, string>;
  expiresIn?: number;
  [key: string]: unknown;
}

interface CloudEnvelope<T> {
  succeed?: boolean;
  data?: T;
  code?: string;
  message?: string;
}

async function cloudCall<T = unknown>(
  path: string,
  init: RequestInit,
  context: string,
): Promise<T> {
  const res = await fetch(`${runtimeHost()}${path}`, init);
  const body = (await asJson(res)) as CloudEnvelope<T> | T | null;
  if (!res.ok) {
    const envelope = body && typeof body === "object" ? (body as CloudEnvelope<T>) : null;
    const hint = envelope?.message ?? envelope?.code ?? "";
    throw new SpectrumError(
      `${context} failed: ${res.status} ${res.statusText}${hint ? ` — ${hint}` : ""}`,
      res.status,
      body,
    );
  }
  if (body && typeof body === "object" && "succeed" in body) {
    const envelope = body as CloudEnvelope<T>;
    if (envelope.succeed === false) {
      throw new SpectrumError(
        `${context} failed: ${envelope.message ?? "succeed=false"}`,
        500,
        envelope,
      );
    }
    if (envelope.data !== undefined) return envelope.data;
  }
  return body as T;
}

export async function issueImessageTokens(
  projectId: string,
  projectSecret: string,
): Promise<ImessageTokensResponse> {
  return cloudCall<ImessageTokensResponse>(
    `/projects/${encodeURIComponent(projectId)}/imessage/tokens`,
    {
      method: "POST",
      headers: { authorization: basicAuth(projectId, projectSecret) },
    },
    "issue-imessage-tokens",
  );
}

export async function getImessageInfo(
  projectId: string,
  projectSecret: string,
): Promise<Record<string, unknown>> {
  return cloudCall<Record<string, unknown>>(
    `/projects/${encodeURIComponent(projectId)}/imessage/`,
    {
      headers: { authorization: basicAuth(projectId, projectSecret) },
    },
    "get-imessage-info",
  );
}

export async function cloudTogglePlatform(
  projectId: string,
  projectSecret: string,
  platform: "imessage" | "whatsapp_business",
  enabled: boolean,
): Promise<void> {
  await cloudCall<Record<string, unknown>>(
    `/projects/${encodeURIComponent(projectId)}/platforms/`,
    {
      method: "PATCH",
      headers: {
        authorization: basicAuth(projectId, projectSecret),
        "content-type": "application/json",
      },
      body: JSON.stringify({ platform, enabled }),
    },
    "cloud-toggle-platform",
  );
}

export interface CloudProjectUser {
  id?: string;
  projectId?: string;
  type?: "shared" | "dedicated";
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  assignedPhoneNumber?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export async function listProjectUsers(
  projectId: string,
  projectSecret: string,
): Promise<CloudProjectUser[]> {
  const body = await cloudCall<{ users?: CloudProjectUser[] } | CloudProjectUser[] | null>(
    `/projects/${encodeURIComponent(projectId)}/users/`,
    { headers: { authorization: basicAuth(projectId, projectSecret) } },
    "list-project-users",
  );
  if (Array.isArray(body)) return body;
  return body?.users ?? [];
}

export function imessageRedirectUrl(phoneNumber: string): string {
  return `sms:${phoneNumber}`;
}
