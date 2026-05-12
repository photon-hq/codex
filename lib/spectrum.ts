function dashboardHost() {
  const h = process.env.SPECTRUM_API_HOST;
  if (!h) throw new Error("SPECTRUM_API_HOST is not set");
  return h.replace(/\/+$/, "");
}

function runtimeHost() {
  const h = process.env.SPECTRUM_RUNTIME_HOST;
  if (!h) throw new Error("SPECTRUM_RUNTIME_HOST is not set");
  return h.replace(/\/+$/, "");
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
}

export async function getSession(bearer: string): Promise<{ user: SessionUser } | null> {
  const res = await fetch(`${dashboardHost()}/api/auth/get-session`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  if (res.status === 401) return null;
  const body = (await expectOk<{ user?: SessionUser }>(res, "get-session")) ?? {};
  if (!body.user) return null;
  return { user: body.user };
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

function basicAuth(projectId: string, projectSecret: string) {
  return `Basic ${Buffer.from(`${projectId}:${projectSecret}`).toString("base64")}`;
}

export interface SharedUserCreateInput {
  phoneNumber?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface SharedUserResult {
  id: string;
  type: "shared";
  phoneNumber: string;
  redirectUri?: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export async function createSharedUser(
  projectId: string,
  projectSecret: string,
  input: SharedUserCreateInput = {},
): Promise<SharedUserResult> {
  const res = await fetch(`${runtimeHost()}/users`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: basicAuth(projectId, projectSecret),
    },
    body: JSON.stringify({ type: "shared", ...input }),
  });
  const body = await expectOk<SharedUserResult>(res, "create-shared-user");
  if (!body?.id || !body.phoneNumber) {
    throw new SpectrumError("create-shared-user returned malformed body", 500, body);
  }
  return body;
}

export function userRedirectUrl(userId: string, msg?: string): string {
  const u = new URL(`${runtimeHost()}/users/${encodeURIComponent(userId)}/redirect`);
  if (msg) u.searchParams.set("msg", msg);
  return u.toString();
}

export interface IssueImessageTokensResult {
  auth: Record<string, string>;
  numbers?: Record<string, string>;
  expiresIn: number;
}

export async function issueImessageTokens(
  projectId: string,
  projectSecret: string,
): Promise<IssueImessageTokensResult> {
  const res = await fetch(`${runtimeHost()}/imessage/tokens`, {
    method: "POST",
    headers: { authorization: basicAuth(projectId, projectSecret) },
  });
  return expectOk<IssueImessageTokensResult>(res, "issue-imessage-tokens");
}
