import { describe, expect, it } from "bun:test";
import {
  CodexCloudError,
  CodexNetworkError,
  isCodexNetworkError,
  isContextLengthExceededError,
  isGithubLinkMissingError,
  isInvalidGrantError,
  isMfaRequiredError,
  isUsageLimitError,
  isWorkspaceBlockedError,
} from "./codex-cloud";

/**
 * These tests pin the wire shapes of every Codex Cloud / ChatGPT error we
 * classify. If ChatGPT changes the shape of an error response (which they
 * do), the failing fixture here will tell us *which* matcher to update —
 * faster than diagnosing it from a production incident.
 *
 * Add a fixture here every time you see a new variant in prod logs.
 */

const ctxRefresh = "wham GET /oauth/token (token refresh) failed: 400";
const ctxWham = "wham GET /wham/tasks failed";

const errFrom = (status: number, body: unknown, context = ctxWham) =>
  new CodexCloudError(`${context}: ${status}`, status, body);

describe("isMfaRequiredError", () => {
  it("matches the canonical 403 detail string", () => {
    expect(
      isMfaRequiredError(errFrom(403, { detail: "Multi-factor authentication required" }))
    ).toBe(true);
  });

  it("matches 'MFA' shorthand in message text", () => {
    expect(
      isMfaRequiredError(
        new CodexCloudError("wham failed: 403 — MFA required for this account", 403, null)
      )
    ).toBe(true);
  });

  it("rejects 401s even with MFA-looking body", () => {
    expect(isMfaRequiredError(errFrom(401, { detail: "Multi-factor required" }))).toBe(false);
  });

  it("rejects non-CodexCloudError values", () => {
    expect(isMfaRequiredError(new Error("Multi-factor authentication required"))).toBe(false);
    expect(isMfaRequiredError(null)).toBe(false);
    expect(isMfaRequiredError(undefined)).toBe(false);
    expect(isMfaRequiredError("MFA required")).toBe(false);
  });
});

describe("isGithubLinkMissingError", () => {
  it("matches the canonical 400 detail.type", () => {
    expect(
      isGithubLinkMissingError(
        errFrom(400, {
          detail: {
            type: "missing_github_connector_link",
            message: "GitHub connection not found for user",
          },
        })
      )
    ).toBe(true);
  });

  it("falls back to message text when body shape changes", () => {
    expect(
      isGithubLinkMissingError(
        new CodexCloudError(
          "wham GET /wham/tasks failed: 400 — missing_github_connector_link",
          400,
          null
        )
      )
    ).toBe(true);
  });

  it("rejects non-400 status with the same detail.type", () => {
    expect(
      isGithubLinkMissingError(
        errFrom(403, { detail: { type: "missing_github_connector_link" } })
      )
    ).toBe(false);
  });

  it("rejects 400 without the specific type", () => {
    expect(isGithubLinkMissingError(errFrom(400, { detail: "validation failed" }))).toBe(false);
    expect(isGithubLinkMissingError(errFrom(400, null))).toBe(false);
  });
});

describe("isInvalidGrantError", () => {
  it("matches 400 invalid_grant from /oauth/token", () => {
    expect(
      isInvalidGrantError(
        new CodexCloudError(
          "token refresh failed: 400",
          400,
          JSON.stringify({ error: "invalid_grant" })
        )
      )
    ).toBe(true);
  });

  it("matches 401 with revoked token text from refresh path", () => {
    expect(
      isInvalidGrantError(
        new CodexCloudError(
          "token refresh failed: 401 — token revoked",
          401,
          { error_description: "Refresh token has been revoked" }
        )
      )
    ).toBe(true);
  });

  it("requires the refresh / code-exchange context to avoid false positives", () => {
    // A wham 401 with the body words 'invalid token' should NOT trip
    // invalid-grant — that path is the access token expiring, which the
    // existing 401 branch handles.
    expect(
      isInvalidGrantError(
        new CodexCloudError("wham GET /wham/tasks failed: 401", 401, {
          detail: "invalid_token",
        })
      )
    ).toBe(false);
  });

  it("rejects non-4xx statuses", () => {
    expect(
      isInvalidGrantError(
        new CodexCloudError("token refresh failed: 500", 500, { error: "invalid_grant" })
      )
    ).toBe(false);
  });

  it("matches code-exchange context", () => {
    expect(
      isInvalidGrantError(
        new CodexCloudError("code exchange failed: 400", 400, { error: "invalid_grant" })
      )
    ).toBe(true);
  });
});

describe("isUsageLimitError", () => {
  it("matches 402 Payment Required", () => {
    expect(isUsageLimitError(errFrom(402, { detail: "Payment Required" }))).toBe(true);
  });

  it("matches body containing usage_limit_reached", () => {
    expect(
      isUsageLimitError(errFrom(429, { error: { code: "usage_limit_reached" } }))
    ).toBe(true);
  });

  it("matches body containing quota_exceeded / insufficient_quota", () => {
    expect(isUsageLimitError(errFrom(400, { detail: "quota_exceeded" }))).toBe(true);
    expect(
      isUsageLimitError(errFrom(400, { error: { code: "insufficient_quota" } }))
    ).toBe(true);
  });

  it("rejects generic 429 without usage-limit signal", () => {
    expect(isUsageLimitError(errFrom(429, { detail: "Rate limit" }))).toBe(false);
  });
});

describe("isWorkspaceBlockedError", () => {
  it("matches 403 that is NOT the MFA case", () => {
    expect(isWorkspaceBlockedError(errFrom(403, { detail: "Forbidden" }))).toBe(true);
    expect(isWorkspaceBlockedError(errFrom(403, null))).toBe(true);
  });

  it("rejects MFA 403 (handled by its own matcher)", () => {
    expect(
      isWorkspaceBlockedError(
        errFrom(403, { detail: "Multi-factor authentication required" })
      )
    ).toBe(false);
  });

  it("rejects non-403 statuses", () => {
    expect(isWorkspaceBlockedError(errFrom(401, null))).toBe(false);
    expect(isWorkspaceBlockedError(errFrom(429, null))).toBe(false);
  });
});

describe("isContextLengthExceededError", () => {
  it("matches CodexCloudError body containing context_window_exceeded", () => {
    expect(
      isContextLengthExceededError(
        errFrom(400, { detail: { type: "context_window_exceeded" } })
      )
    ).toBe(true);
  });

  it("matches 'maximum context length' verbiage in plain Error", () => {
    expect(
      isContextLengthExceededError(new Error("maximum context length is 200000 tokens"))
    ).toBe(true);
  });

  it("matches context_length_exceeded variant", () => {
    expect(
      isContextLengthExceededError(errFrom(400, { detail: "context_length_exceeded" }))
    ).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isContextLengthExceededError(errFrom(429, { detail: "Rate limit" }))).toBe(false);
    expect(isContextLengthExceededError("just a string")).toBe(false);
  });
});

describe("isCodexNetworkError", () => {
  it("matches CodexNetworkError instances", () => {
    expect(
      isCodexNetworkError(
        new CodexNetworkError(
          "wham GET /wham/tasks network error: socket hang up",
          "ECONNRESET",
          new Error("socket hang up")
        )
      )
    ).toBe(true);
  });

  it("does NOT match CodexCloudError (those are server-returned)", () => {
    expect(isCodexNetworkError(errFrom(500, null))).toBe(false);
  });

  it("does NOT match plain Error", () => {
    expect(isCodexNetworkError(new Error("ECONNRESET"))).toBe(false);
  });
});

describe("classifier exclusivity (no two matchers fire on the same error)", () => {
  // Each fixture should match exactly one classifier. This catches the
  // class of bug where adding a new matcher accidentally subsumes an
  // existing one (e.g. isWorkspaceBlockedError swallowing MFA cases).
  const cases: Array<{
    name: string;
    err: unknown;
    expected:
      | "mfa"
      | "github"
      | "invalid_grant"
      | "usage_limit"
      | "workspace_blocked"
      | "context_length"
      | "network";
  }> = [
    {
      name: "MFA 403",
      err: errFrom(403, { detail: "Multi-factor authentication required" }),
      expected: "mfa",
    },
    {
      name: "GitHub-missing 400",
      err: errFrom(400, { detail: { type: "missing_github_connector_link" } }),
      expected: "github",
    },
    {
      name: "invalid_grant from refresh",
      err: new CodexCloudError("token refresh failed: 400", 400, { error: "invalid_grant" }),
      expected: "invalid_grant",
    },
    {
      name: "usage-limit 402",
      err: errFrom(402, { detail: "Payment Required" }),
      expected: "usage_limit",
    },
    {
      name: "workspace-blocked 403",
      err: errFrom(403, { detail: "Forbidden" }),
      expected: "workspace_blocked",
    },
    {
      name: "context-length 400",
      err: errFrom(400, { detail: { type: "context_window_exceeded" } }),
      expected: "context_length",
    },
    {
      name: "network error",
      err: new CodexNetworkError("network down", "ECONNRESET", null),
      expected: "network",
    },
  ];

  for (const c of cases) {
    it(`'${c.name}' is classified exactly as '${c.expected}'`, () => {
      const matchers = {
        mfa: isMfaRequiredError(c.err),
        github: isGithubLinkMissingError(c.err),
        invalid_grant: isInvalidGrantError(c.err),
        usage_limit: isUsageLimitError(c.err),
        workspace_blocked: isWorkspaceBlockedError(c.err),
        context_length: isContextLengthExceededError(c.err),
        network: isCodexNetworkError(c.err),
      } as const;
      const hits = Object.entries(matchers).filter(([, v]) => v);
      expect(hits.map(([k]) => k)).toEqual([c.expected]);
    });
  }
});
