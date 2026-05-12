// Accepts legacy `sk-`, project (`sk-proj-`), service account (`sk-svcacct-`),
// and admin (`sk-admin-`) keys.
export const OPENAI_KEY_PATTERN = /^sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}$/;
export const MIN_KEY_LENGTH = 40;
export const MAX_KEY_LENGTH = 400;

export function isOpenAIKeyShape(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < MIN_KEY_LENGTH || trimmed.length > MAX_KEY_LENGTH) return false;
  return OPENAI_KEY_PATTERN.test(trimmed);
}

export type KeyVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "bad_shape"
        | "unauthorized"
        | "forbidden"
        | "rate_limited"
        | "network_error"
        | "openai_error";
      message: string;
    };

export async function verifyOpenAIKey(
  rawKey: string,
  init?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<KeyVerifyResult> {
  const key = rawKey.trim();
  if (!isOpenAIKeyShape(key)) {
    return {
      ok: false,
      reason: "bad_shape",
      message: "That doesn't look like an OpenAI API key (should start with sk-).",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 8_000);
  init?.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const res = await fetch("https://api.openai.com/v1/models?limit=1", {
      method: "GET",
      headers: {
        authorization: `Bearer ${key}`,
        "user-agent": "codex/1.0 (+key-verify)",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (res.ok) return { ok: true };

    if (res.status === 401) {
      return {
        ok: false,
        reason: "unauthorized",
        message: "OpenAI rejected the key. Check that it's active and not revoked.",
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        reason: "forbidden",
        message:
          "OpenAI accepted the key but the project/scopes don't allow API access. Use a key with model access.",
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        reason: "rate_limited",
        message: "OpenAI is rate-limiting verification. Try again in a moment.",
      };
    }

    let detail = `OpenAI returned ${res.status}.`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = body.error.message;
    } catch {}
    return { ok: false, reason: "openai_error", message: detail };
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      message:
        err instanceof Error && err.name === "AbortError"
          ? "Verification timed out. Check your network and try again."
          : "Couldn't reach OpenAI to verify the key. Check your network and try again.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
