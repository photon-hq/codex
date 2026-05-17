const AUTH_HOST = "https://auth.openai.com";
const CHATGPT_HOST = "https://chatgpt.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_REDIRECT = `${AUTH_HOST}/deviceauth/callback`;
const VERIFICATION_URL = `${AUTH_HOST}/codex/device`;
const REFRESH_LEEWAY_MS = 5 * 60 * 1000;
const REQUEST_UA = "codex/1.0 (+codex-on-imessage)";

export class CodexCloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "CodexCloudError";
  }
}

/**
 * Thrown when we couldn't even reach Codex Cloud (DNS, TCP, TLS, socket
 * timeout, abort). Distinct from `CodexCloudError`, which means the server
 * answered with a non-2xx status. The bridge surfaces these to the user as
 * "couldn't reach OpenAI — try again in a moment."
 */
export class CodexNetworkError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly cause: unknown
  ) {
    super(message);
    this.name = "CodexNetworkError";
  }
}

export function isCodexNetworkError(err: unknown): err is CodexNetworkError {
  return err instanceof CodexNetworkError;
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

function extractErrCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; cause?: unknown };
  if (typeof e.code === "string") return e.code;
  if (e.cause && typeof e.cause === "object") {
    const c = (e.cause as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return undefined;
}

function looksLikeNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = extractErrCode(err);
  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  // Node fetch wraps low-level failures as `TypeError: fetch failed`.
  if (err.name === "TypeError" && /fetch failed/i.test(err.message)) return true;
  if (/network|socket hang up|other side closed|aborted|timed? ?out/i.test(err.message)) {
    return true;
  }
  return false;
}

/**
 * True for HTTP statuses we expect to be transient: server overloaded,
 * bad gateway, gateway timeout, etc. 429 is *not* in this set — the user's
 * plan is rate-limiting us and retrying immediately would be rude. We surface
 * 429 to the user with friendly text instead.
 */
function isRetryableStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

const RETRY_BACKOFF_MS = [400, 1200, 3000];

/**
 * True when `err` is a Codex Cloud error indicating the linked ChatGPT account's
 * token doesn't satisfy MFA requirements. Returned by the Wham API as
 * `403 { detail: "Multi-factor authentication required" }`. Per
 * https://developers.openai.com/codex/auth, the fix is for the user to enable
 * MFA *and* "device code login" in chatgpt.com → Settings → Security and
 * re-link Codex.
 */
export function isMfaRequiredError(err: unknown): err is CodexCloudError {
  if (!(err instanceof CodexCloudError)) {
    return false;
  }
  if (err.status !== 403) {
    return false;
  }
  if (/multi.?factor|\bmfa\b|two.?factor|2fa/i.test(err.message)) {
    return true;
  }
  if (err.body && typeof err.body === "object") {
    const detail = (err.body as { detail?: unknown }).detail;
    if (typeof detail === "string" && /multi.?factor|\bmfa\b/i.test(detail)) {
      return true;
    }
  }
  return false;
}

/**
 * True when `err` is a Codex Cloud error indicating the linked ChatGPT account
 * hasn't connected GitHub. Returned by the Wham API as
 * `400 { detail: { type: "missing_github_connector_link", message: ... } }`.
 * The fix is for the user to open chatgpt.com → Codex → Environments and link
 * their GitHub account, then re-link Codex in our dashboard so we get a fresh
 * access token whose Wham calls succeed.
 *
 * Distinct from the `412` "no environments" case (`listEnvironments` returns
 * an empty array): there GitHub *is* linked, the user just hasn't connected
 * a repo to a Codex environment yet.
 */
/**
 * True when `err` indicates the linked ChatGPT account has hit its Codex
 * usage / billing limit. ChatGPT returns this as 402 Payment Required, or
 * 4xx with body strings like `usage_limit_reached`, `quota_exceeded`, or
 * `insufficient_quota`. The user needs to upgrade their plan or wait for
 * their window to reset; no amount of retrying will help.
 */
export function isUsageLimitError(err: unknown): err is CodexCloudError {
  if (!(err instanceof CodexCloudError)) return false;
  if (err.status === 402) return true;
  const haystack = `${err.message} ${JSON.stringify(err.body ?? "")}`.toLowerCase();
  return /usage[_ ]?limit|quota[_ ]?exceeded|insufficient[_ ]?quota|plan[_ ]?limit/.test(
    haystack
  );
}

/**
 * True when `err` is a 403 from Codex that's NOT the MFA case. Most commonly
 * this is a ChatGPT workspace admin blocking Codex Cloud access for this
 * member, or SSO-restricted accounts. See openai/codex#12651 for the upstream
 * report on `/wham/tasks/list` + `/wham/environments` returning 403 in
 * enterprise setups.
 */
export function isWorkspaceBlockedError(err: unknown): err is CodexCloudError {
  if (!(err instanceof CodexCloudError)) return false;
  if (err.status !== 403) return false;
  if (isMfaRequiredError(err)) return false;
  return true;
}

/**
 * True when the model rejected the turn because the conversation has grown
 * past its context window. Codex's canonical error variant for this is
 * `ContextWindowExceeded` (see codex-rs/protocol/src/error.rs). The fix is
 * for the user to start a fresh thread via /new.
 */
export function isContextLengthExceededError(err: unknown): boolean {
  const msg =
    err instanceof CodexCloudError
      ? `${err.message} ${JSON.stringify(err.body ?? "")}`
      : err instanceof Error
        ? err.message
        : String(err);
  return /context[_ ]?(window|length)[_ ]?(exceeded|too[_ ]?long)|maximum context length/i.test(
    msg
  );
}

export function isGithubLinkMissingError(err: unknown): err is CodexCloudError {
  if (!(err instanceof CodexCloudError)) {
    return false;
  }
  if (err.status !== 400) {
    return false;
  }
  if (err.body && typeof err.body === "object") {
    const detail = (err.body as { detail?: unknown }).detail;
    if (detail && typeof detail === "object") {
      const t = (detail as { type?: unknown }).type;
      if (t === "missing_github_connector_link") {
        return true;
      }
    }
  }
  if (/missing_github_connector_link|github connection not found/i.test(err.message)) {
    return true;
  }
  return false;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function expectOk<T>(res: Response, context: string): Promise<T> {
  if (res.ok) {
    return (await readJson(res)) as T;
  }
  const body = await readJson(res);
  let hint = "";
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const err = b.error;
    if (typeof err === "string") {
      hint = err;
    } else if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      hint =
        (typeof e.message === "string" && e.message) ||
        (typeof e.code === "string" && e.code) ||
        "";
    } else if (typeof b.detail === "string") {
      hint = b.detail;
    }
  } else if (typeof body === "string" && body.length > 0 && body.length < 240) {
    hint = body;
  }
  const suffix = hint ? ` — ${hint}` : "";
  throw new CodexCloudError(
    `${context} failed: ${res.status} ${res.statusText}${suffix}`,
    res.status,
    body
  );
}

export interface DeviceCodeResponse {
  device_auth_id: string;
  expires_at: string;
  interval: number;
  user_code: string;
  verification_url: string;
}

export async function startDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(`${AUTH_HOST}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": REQUEST_UA,
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
    cache: "no-store",
  });
  const data = await expectOk<{
    device_auth_id: string;
    user_code: string;
    interval: number | string;
    expires_at: string;
  }>(res, "device-code start");
  return {
    device_auth_id: data.device_auth_id,
    user_code: data.user_code,
    interval: typeof data.interval === "string" ? Number(data.interval) || 5 : data.interval,
    expires_at: data.expires_at,
    verification_url: VERIFICATION_URL,
  };
}

export type DevicePollResult =
  | { status: "pending" }
  | { status: "authorized"; tokens: ChatgptTokens; user: ChatgptUserClaims }
  | { status: "expired" }
  | { status: "error"; message: string };

interface DeviceCodeSuccess {
  authorization_code: string;
  code_challenge: string;
  code_verifier: string;
}

export async function pollDeviceCode(
  deviceAuthId: string,
  userCode: string
): Promise<DevicePollResult> {
  const res = await fetch(`${AUTH_HOST}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": REQUEST_UA,
    },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    cache: "no-store",
  });
  if (res.status === 403 || res.status === 404) {
    return { status: "pending" };
  }
  if (res.status === 410) {
    return { status: "expired" };
  }
  if (!res.ok) {
    const body = await readJson(res);
    return {
      status: "error",
      message: typeof body === "string" ? body : `HTTP ${res.status}`,
    };
  }
  const code = (await res.json()) as DeviceCodeSuccess;
  const tokens = await exchangeAuthorizationCode(code);
  const user = parseIdToken(tokens.id_token);
  return { status: "authorized", tokens, user };
}

export interface ChatgptTokens {
  access_token: string;
  expires_at: number;
  id_token: string;
  refresh_token: string;
}

async function exchangeAuthorizationCode(code: DeviceCodeSuccess): Promise<ChatgptTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: code.authorization_code,
    redirect_uri: DEVICE_REDIRECT,
    client_id: CLIENT_ID,
    code_verifier: code.code_verifier,
  });
  const res = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": REQUEST_UA,
    },
    body: body.toString(),
    cache: "no-store",
  });
  const data = await expectOk<{
    id_token: string;
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  }>(res, "code exchange");
  return tokensFromResponse(data);
}

export async function refreshTokens(refreshToken: string): Promise<ChatgptTokens> {
  const res = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": REQUEST_UA,
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  const data = await expectOk<{
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>(res, "token refresh");
  if (!(data.access_token && data.refresh_token && data.id_token)) {
    throw new CodexCloudError("refresh response missing tokens", 500, data);
  }
  return tokensFromResponse({
    id_token: data.id_token,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  });
}

function tokensFromResponse(data: {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}): ChatgptTokens {
  const exp = expiryFromAccessToken(data.access_token, data.expires_in);
  return {
    id_token: data.id_token,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: exp,
  };
}

function expiryFromAccessToken(token: string, fallbackSeconds: number | undefined): number {
  try {
    const payload = decodeJwtPayload(token);
    if (typeof payload.exp === "number") {
      return payload.exp * 1000;
    }
  } catch {}
  if (fallbackSeconds && Number.isFinite(fallbackSeconds)) {
    return Date.now() + fallbackSeconds * 1000;
  }
  return Date.now() + 60 * 60 * 1000;
}

export interface ChatgptUserClaims {
  account_id: string | null;
  email: string | null;
  name: string | null;
  plan_type: string | null;
  user_id: string | null;
}

export function parseIdToken(idToken: string): ChatgptUserClaims {
  try {
    const payload = decodeJwtPayload(idToken);
    const auth =
      (payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined) ?? {};
    return {
      email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" ? payload.name : null,
      account_id: typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id : null,
      user_id: typeof auth.chatgpt_user_id === "string" ? auth.chatgpt_user_id : null,
      plan_type: typeof auth.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : null,
    };
  } catch {
    return { email: null, name: null, account_id: null, user_id: null, plan_type: null };
  }
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    throw new Error("not a JWT");
  }
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

export interface StoredTokens {
  access_token: string;
  expires_at: number;
  refresh_token: string;
}

export interface FreshTokens extends StoredTokens {
  rotated: boolean;
  user?: ChatgptUserClaims;
}

export async function ensureFreshAccessToken(stored: StoredTokens): Promise<FreshTokens> {
  if (stored.expires_at - Date.now() > REFRESH_LEEWAY_MS) {
    return { ...stored, rotated: false };
  }
  const next = await refreshTokens(stored.refresh_token);
  return {
    access_token: next.access_token,
    refresh_token: next.refresh_token,
    expires_at: next.expires_at,
    rotated: true,
    user: parseIdToken(next.id_token),
  };
}

export interface WhamEnvironment {
  archived: boolean;
  id: string;
  isPinned?: boolean;
  label: string;
  repos: string[];
  taskCount?: number;
}

export interface WhamTask {
  id: string;
  status: string;
  title: string;
  url: string;
}

export interface WhamCreateResult {
  current_turn_id: string | null;
  task: WhamTask;
}

export interface WhamReply {
  current_turn_id: string | null;
  error: string | null;
  pull_request_url: string | null;
  status: string;
  text: string;
}

export interface ImageInput {
  asset_pointer: string;
  height: number;
  size_bytes: number;
  width: number;
}

interface WhamHttpInit {
  accessToken: string;
  body?: unknown;
  method?: string;
  query?: Record<string, string | number | undefined>;
}

async function wham<T>(path: string, init: WhamHttpInit): Promise<T> {
  const url = new URL(`${CHATGPT_HOST}/backend-api${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined) {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.accessToken}`,
    Accept: "application/json",
    "User-Agent": REQUEST_UA,
  };
  let body: BodyInit | undefined;
  if (init.body !== undefined && init.body !== null) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const method = init.method ?? (body ? "POST" : "GET");
  // Only retry idempotent calls. Retrying POST /wham/tasks would risk
  // creating duplicate Codex tasks if the server actually received the
  // request but the response stream got truncated.
  const retryable = method === "GET";
  const context = `wham ${method} ${path}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= (retryable ? RETRY_BACKOFF_MS.length : 0); attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        cache: "no-store",
      });
      if (retryable && isRetryableStatus(res.status)) {
        // Drain body so the connection can be reused and we have something
        // useful in the eventual error if all retries fail.
        const text = await res.text().catch(() => "");
        lastErr = new CodexCloudError(
          `${context} failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
          res.status,
          text || null
        );
        if (attempt < RETRY_BACKOFF_MS.length) {
          console.warn(
            `[codex] ${context} ${res.status} ${res.statusText} — retrying in ${RETRY_BACKOFF_MS[attempt]}ms (attempt ${attempt + 1}/${RETRY_BACKOFF_MS.length})`
          );
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
          continue;
        }
        throw lastErr;
      }
      return await expectOk<T>(res, context);
    } catch (err) {
      // `expectOk` always throws CodexCloudError; only re-throw non-retryable.
      if (err instanceof CodexCloudError) {
        if (retryable && isRetryableStatus(err.status) && attempt < RETRY_BACKOFF_MS.length) {
          lastErr = err;
          console.warn(
            `[codex] ${context} ${err.status} — retrying in ${RETRY_BACKOFF_MS[attempt]}ms (attempt ${attempt + 1}/${RETRY_BACKOFF_MS.length})`
          );
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
          continue;
        }
        throw err;
      }
      if (looksLikeNetworkError(err)) {
        lastErr = new CodexNetworkError(
          `${context} network error: ${(err as Error).message}`,
          extractErrCode(err),
          err
        );
        if (retryable && attempt < RETRY_BACKOFF_MS.length) {
          console.warn(
            `[codex] ${context} network error (${extractErrCode(err) ?? (err as Error).message}) — retrying in ${RETRY_BACKOFF_MS[attempt]}ms (attempt ${attempt + 1}/${RETRY_BACKOFF_MS.length})`
          );
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
          continue;
        }
        throw lastErr;
      }
      throw err;
    }
  }
  // Unreachable in practice (loop either returns or throws), but keep
  // TypeScript happy.
  throw lastErr ?? new CodexCloudError(`${context} failed with no result`, 500, null);
}

export async function listEnvironments(accessToken: string): Promise<WhamEnvironment[]> {
  const data = await wham<
    Array<{
      id: string;
      label: string;
      repos?: string[];
      is_pinned?: boolean;
      task_count?: number;
    }>
  >("/wham/environments", { accessToken });
  return data.map((row) => ({
    id: row.id,
    label: row.label,
    repos: row.repos ?? [],
    archived: false,
    isPinned: !!row.is_pinned,
    taskCount: row.task_count ?? 0,
  }));
}

export async function pickDefaultEnvironment(accessToken: string): Promise<WhamEnvironment | null> {
  const envs = await listEnvironments(accessToken);
  const pinned = envs.find((e) => e.isPinned && e.repos.length > 0);
  if (pinned) {
    return pinned;
  }
  const withRepo = envs.filter((e) => e.repos.length > 0);
  return withRepo[0] ?? null;
}

export async function uploadImage(opts: {
  accessToken: string;
  bytes: Uint8Array | Buffer;
  filename: string;
  mimeType: string;
}): Promise<ImageInput> {
  const size = opts.bytes.byteLength;
  const reg = await wham<{ upload_url: string; file_id: string }>("/files", {
    accessToken: opts.accessToken,
    body: { file_name: opts.filename, file_size: size, use_case: "multimodal" },
  });
  const blob = new Blob([opts.bytes as BlobPart], { type: opts.mimeType });
  const put = await fetch(reg.upload_url, {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": opts.mimeType },
    body: blob,
  });
  if (!put.ok) {
    throw new CodexCloudError(
      `blob upload failed: ${put.status} ${put.statusText}`,
      put.status,
      null
    );
  }
  await wham<unknown>(`/files/${reg.file_id}/uploaded`, {
    accessToken: opts.accessToken,
    body: {},
  });
  const dims = imageDimensions(opts.bytes, opts.mimeType);
  return {
    asset_pointer: `file-service://${reg.file_id}`,
    width: dims.width,
    height: dims.height,
    size_bytes: size,
  };
}

function imageDimensions(
  buf: Uint8Array | Buffer,
  mime: string
): { width: number; height: number } {
  const b = buf instanceof Buffer ? buf : Buffer.from(buf);
  if (mime === "image/png" && b.length >= 24 && b.subarray(1, 4).toString() === "PNG") {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (
    (mime === "image/jpeg" || mime === "image/jpg") &&
    b.length > 4 &&
    b[0] === 0xff &&
    b[1] === 0xd8
  ) {
    let i = 2;
    while (i + 8 < b.length) {
      if (b[i] !== 0xff) {
        break;
      }
      const marker = b[i + 1];
      const segLen = b.readUInt16BE(i + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const height = b.readUInt16BE(i + 5);
        const width = b.readUInt16BE(i + 7);
        return { width, height };
      }
      i += 2 + segLen;
    }
  }
  if (mime === "image/gif" && b.length >= 10 && b.subarray(0, 3).toString() === "GIF") {
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (mime === "image/webp" && b.length >= 30 && b.subarray(0, 4).toString() === "RIFF") {
    if (b.subarray(12, 16).toString() === "VP8 ") {
      return { width: b.readUInt16LE(26) & 0x3f_ff, height: b.readUInt16LE(28) & 0x3f_ff };
    }
    if (b.subarray(12, 16).toString() === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3f_ff) + 1, height: ((bits >> 14) & 0x3f_ff) + 1 };
    }
    if (b.subarray(12, 16).toString() === "VP8X") {
      const w = ((b[24] | (b[25] << 8) | (b[26] << 16)) & 0xff_ff_ff) + 1;
      const h = ((b[27] | (b[28] << 8) | (b[29] << 16)) & 0xff_ff_ff) + 1;
      return { width: w, height: h };
    }
  }
  return { width: 1024, height: 1024 };
}

export interface CreateTaskOptions {
  accessToken: string;
  branch: string;
  environmentId: string;
  images?: ImageInput[];
  text: string;
}

export async function createTask(opts: CreateTaskOptions): Promise<WhamCreateResult> {
  const inputItems: unknown[] = [];
  for (const img of opts.images ?? []) {
    inputItems.push({
      type: "image_asset_pointer",
      asset_pointer: img.asset_pointer,
      width: img.width,
      height: img.height,
      size_bytes: img.size_bytes,
    });
  }
  inputItems.push({
    type: "message",
    role: "user",
    content: [{ content_type: "text", text: opts.text }],
  });
  const res = await wham<{
    task: { id: string; title: string; current_turn_id: string | null };
  }>("/wham/tasks", {
    accessToken: opts.accessToken,
    body: {
      input_items: inputItems,
      new_task: {
        environment_id: opts.environmentId,
        branch: opts.branch,
        attempt_total: 1,
      },
    },
  });
  return {
    task: {
      id: res.task.id,
      title: res.task.title,
      status: "pending",
      url: `${CHATGPT_HOST}/codex/tasks/${res.task.id}`,
    },
    current_turn_id: res.task.current_turn_id,
  };
}

export interface FollowUpOptions {
  accessToken: string;
  images?: ImageInput[];
  previousTurnId: string;
  taskId: string;
  text: string;
}

export async function followUp(opts: FollowUpOptions): Promise<WhamCreateResult> {
  const inputItems: unknown[] = [];
  for (const img of opts.images ?? []) {
    inputItems.push({
      type: "image_asset_pointer",
      asset_pointer: img.asset_pointer,
      width: img.width,
      height: img.height,
      size_bytes: img.size_bytes,
    });
  }
  inputItems.push({
    type: "message",
    role: "user",
    content: [{ content_type: "text", text: opts.text }],
  });
  const res = await wham<{
    task: { id: string; title: string; current_turn_id: string | null };
  }>("/wham/tasks", {
    accessToken: opts.accessToken,
    body: {
      input_items: inputItems,
      follow_up: {
        task_id: opts.taskId,
        turn_id: opts.previousTurnId,
      },
    },
  });
  return {
    task: {
      id: res.task.id,
      title: res.task.title,
      status: "pending",
      url: `${CHATGPT_HOST}/codex/tasks/${res.task.id}`,
    },
    current_turn_id: res.task.current_turn_id,
  };
}

interface RawTask {
  current_assistant_turn?: {
    id?: string;
    output_items?: Array<
      | { type: "message"; role: string; content: Array<{ content_type: string; text?: string }> }
      | { type: string; [k: string]: unknown }
    >;
    error?: unknown;
    pull_request_data?: { url?: string } | null;
  };
  task: {
    id: string;
    title: string;
    task_status_display?: {
      latest_turn_status_display?: { turn_status?: string };
    };
    external_pull_requests?: Array<{ url?: string }>;
  };
}

export async function pollTask(accessToken: string, taskId: string): Promise<WhamReply> {
  const raw = await wham<RawTask>(`/wham/tasks/${taskId}`, { accessToken });
  const status = raw.task.task_status_display?.latest_turn_status_display?.turn_status ?? "pending";
  const turnId = raw.current_assistant_turn?.id ?? null;
  const text = (raw.current_assistant_turn?.output_items ?? [])
    .flatMap((item) => {
      if (item.type === "message" && Array.isArray((item as { content?: unknown[] }).content)) {
        const content = (item as { content: Array<{ content_type: string; text?: string }> })
          .content;
        return content
          .filter((c) => c.content_type === "text" && typeof c.text === "string")
          .map((c) => c.text as string);
      }
      return [];
    })
    .join("\n")
    .trim();
  let prUrl: string | null = null;
  const prData = raw.current_assistant_turn?.pull_request_data;
  if (prData && typeof prData.url === "string") {
    prUrl = prData.url;
  }
  if (!prUrl) {
    const ext = raw.task.external_pull_requests?.find((p) => typeof p.url === "string");
    if (ext?.url) {
      prUrl = ext.url;
    }
  }
  let errorMsg: string | null = null;
  const err = raw.current_assistant_turn?.error;
  if (err) {
    if (typeof err === "string") {
      errorMsg = err;
    } else if (
      typeof err === "object" &&
      err &&
      "message" in err &&
      typeof (err as { message: unknown }).message === "string"
    ) {
      errorMsg = (err as { message: string }).message;
    } else {
      errorMsg = "Codex hit an internal error.";
    }
  }
  return { status, text, current_turn_id: turnId, pull_request_url: prUrl, error: errorMsg };
}

export interface WaitForReplyOptions {
  accessToken: string;
  intervalMs?: number;
  onProgress?: (status: string) => void;
  taskId: string;
  timeoutMs?: number;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "errored"]);

export async function waitForReply(opts: WaitForReplyOptions): Promise<WhamReply> {
  const timeout = opts.timeoutMs ?? 8 * 60 * 1000;
  const interval = opts.intervalMs ?? 2500;
  const start = Date.now();
  let last: WhamReply | null = null;
  while (Date.now() - start < timeout) {
    const reply = await pollTask(opts.accessToken, opts.taskId);
    last = reply;
    if (opts.onProgress) {
      opts.onProgress(reply.status);
    }
    if (TERMINAL_STATUSES.has(reply.status)) {
      return reply;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return (
    last ?? {
      status: "timeout",
      text: "",
      current_turn_id: null,
      pull_request_url: null,
      error: "Codex took too long to reply.",
    }
  );
}

export const codexCloud = {
  CLIENT_ID,
  CHATGPT_HOST,
  AUTH_HOST,
  VERIFICATION_URL,
};
