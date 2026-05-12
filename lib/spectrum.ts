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

export async function getSession(bearer: string): Promise<{ user: SessionUser } | null> {
  const res = await fetch(`${dashboardHost()}/api/auth/get-session`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  if (res.status === 401) return null;
  const body = (await expectOk<{ user?: SessionUser }>(res, "get-session")) ?? {};
  if (!body.user) return null;
  return { user: body.user };
}

export interface SpectrumUserResult {
  user?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
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
  const res = await fetch(
    `${dashboardHost()}/api/projects/${encodeURIComponent(projectId)}/spectrum/users`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phoneNumber: input.phoneNumber,
        sendInvite: input.sendInvite ?? false,
      }),
    },
  );
  const body = await expectOk<SpectrumUserResult>(res, "create-spectrum-user");
  if (body?.error) throw new SpectrumError(body.error, 500, body);
  return body ?? {};
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

export interface SpectrumLine {
  id: string;
  platform?: string;
  phoneNumber?: string | null;
  status?: string | null;
}

interface CreateLineResult {
  success?: true;
  line?: SpectrumLine;
  error?: string;
}

export async function listLines(bearer: string, projectId: string): Promise<SpectrumLine[]> {
  const res = await fetch(
    `${dashboardHost()}/api/projects/${encodeURIComponent(projectId)}/lines`,
    {
      headers: { authorization: `Bearer ${bearer}` },
    },
  );
  const body = await expectOk<SpectrumLine[] | { data?: SpectrumLine[] }>(res, "list-lines");
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray(body.data)) return body.data;
  return [];
}

export async function createImessageLine(
  bearer: string,
  projectId: string,
): Promise<{ id: string; phoneNumber: string }> {
  const res = await fetch(
    `${dashboardHost()}/api/projects/${encodeURIComponent(projectId)}/lines`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ platform: "imessage" }),
    },
  );
  const body = await expectOk<CreateLineResult>(res, "create-line");
  if (body?.error) throw new SpectrumError(body.error, 500, body);
  if (!body?.line?.id || !body.line.phoneNumber) {
    throw new SpectrumError("create-line returned malformed body", 500, body);
  }
  return { id: body.line.id, phoneNumber: body.line.phoneNumber };
}

async function fetchJsonWithBearer(bearer: string, path: string): Promise<unknown> {
  const res = await fetch(`${dashboardHost()}${path}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  if (!res.ok) {
    throw new SpectrumError(
      `${path} failed: ${res.status} ${res.statusText}`,
      res.status,
      await asJson(res),
    );
  }
  return asJson(res);
}

function pickPhoneNumber(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const keys = ["phoneNumber", "phone_number", "phone", "msisdn", "number"];
  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k];
    if (typeof v === "string" && /^\+?\d{6,}$/.test(v.trim())) return v.trim();
  }
  return null;
}

function deepFindImessagePhone(
  value: unknown,
  depth = 0,
): { id?: string; phoneNumber: string } | null {
  if (depth > 6 || !value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = deepFindImessagePhone(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const platform = typeof obj.platform === "string" ? obj.platform.toLowerCase() : null;
  const phone = pickPhoneNumber(obj);
  if (phone && (platform === null || platform === "imessage" || platform === "ios")) {
    const id = typeof obj.id === "string" ? obj.id : undefined;
    return { id, phoneNumber: phone };
  }
  for (const v of Object.values(obj)) {
    const hit = deepFindImessagePhone(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export async function findAssignedImessageNumber(
  bearer: string,
  projectId: string,
): Promise<{ id: string; phoneNumber: string } | null> {
  const probes: Array<{ path: string; label: string }> = [
    { path: `/api/projects/${encodeURIComponent(projectId)}/lines`, label: "lines" },
    { path: `/api/projects/${encodeURIComponent(projectId)}/platforms`, label: "platforms" },
    { path: `/api/projects/${encodeURIComponent(projectId)}`, label: "project" },
    {
      path: `/api/projects/${encodeURIComponent(projectId)}/spectrum/profile`,
      label: "spectrum-profile",
    },
  ];
  for (const { path, label } of probes) {
    try {
      const body = await fetchJsonWithBearer(bearer, path);
      const hit = deepFindImessagePhone(body);
      if (hit?.phoneNumber) {
        return { id: hit.id ?? `${label}:assigned`, phoneNumber: hit.phoneNumber };
      }
    } catch (err) {
      console.warn(`[spectrum] probe ${label} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
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

export async function provisionImessage(
  bearer: string,
  projectId: string,
  projectSecret: string,
): Promise<{ id: string; phoneNumber: string }> {
  await cloudTogglePlatform(projectId, projectSecret, "imessage", true);

  const tokens = await issueImessageTokens(projectId, projectSecret);
  console.log("[spectrum] imessage tokens response keys:", Object.keys(tokens));

  if (tokens.type === "dedicated" && tokens.numbers) {
    const entries = Object.entries(tokens.numbers);
    if (entries.length > 0) {
      const [instanceId, phoneNumber] = entries[0];
      if (typeof phoneNumber === "string" && phoneNumber.length > 0) {
        return { id: instanceId, phoneNumber };
      }
    }
  }

  const scanned = deepFindImessagePhone(tokens);
  if (scanned?.phoneNumber) {
    return { id: scanned.id ?? `${projectId}:imessage`, phoneNumber: scanned.phoneNumber };
  }

  try {
    const info = await getImessageInfo(projectId, projectSecret);
    console.log("[spectrum] imessage info response:", info);
    const infoPhone = deepFindImessagePhone(info);
    if (infoPhone?.phoneNumber) {
      return { id: infoPhone.id ?? `${projectId}:imessage`, phoneNumber: infoPhone.phoneNumber };
    }
  } catch (err) {
    console.warn("[spectrum] get-imessage-info failed:", err instanceof Error ? err.message : err);
  }

  const dashboardScan = await findAssignedImessageNumber(bearer, projectId);
  if (dashboardScan) return dashboardScan;

  throw new SpectrumError(
    `iMessage activated but no phone number was returned (type=${tokens.type}). Check the Spectrum dashboard for the assigned number.`,
    500,
    tokens,
  );
}

export function imessageRedirectUrl(phoneNumber: string): string {
  return `sms:${phoneNumber}`;
}
