"use client";

import {
  AsYouType,
  type CountryCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import { AlertCircle, ArrowRight, Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChatGPTChip, CodexIcon, SpectrumChip } from "@/components/chrome";
import { CountryDialPicker } from "@/components/country-dial-picker";
import { type Country, DEFAULT_COUNTRY, findByIso } from "@/lib/country-codes";

type Stage =
  | "codex"
  | "codex-device"
  | "codex-success"
  | "mfa"
  | "github"
  | "github-repo"
  | "spectrum-device"
  | "phone"
  | "done";

interface CodexDeviceState {
  expires_at: string;
  interval: number;
  user_code: string;
  verification_uri_complete: string | null;
  verification_url: string;
}

interface SpectrumDeviceState {
  expires_in: number;
  interval: number;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string | null;
}

const STEP_INDEX: Record<Stage, number> = {
  codex: 0,
  "codex-device": 0,
  "codex-success": 0,
  // MFA / GitHub-link-missing / GitHub-repo-missing all happen during/after
  // Codex sign-in, so keep the user visually on step 0 while we ask them to
  // fix their account settings.
  mfa: 0,
  github: 0,
  "github-repo": 0,
  "spectrum-device": 1,
  phone: 2,
  done: 3,
};
const TOTAL_STEPS = 4;

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {}

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export default function OnboardClient() {
  const router = useRouter();
  const [bootstrapped, setBootstrapped] = useState(false);
  const [stage, setStage] = useState<Stage>("codex");
  const [userPhone, setUserPhone] = useState("");
  const [codexDevice, setCodexDevice] = useState<CodexDeviceState | null>(null);
  const [codexUser, setCodexUser] = useState<{ email: string | null; name: string | null } | null>(
    null
  );
  const [spectrumDevice, setSpectrumDevice] = useState<SpectrumDeviceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDeviceAuthHint, setShowDeviceAuthHint] = useState(false);

  useEffect(() => {
    void fetch("/api/tenant/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.provisioned && data.tenant.codexLinked) {
          router.replace("/dashboard");
          return;
        }
        setBootstrapped(true);
      })
      .catch(() => setBootstrapped(true));
  }, [router]);

  useEffect(() => {
    if (stage !== "done") {
      return;
    }
    router.replace("/dashboard");
  }, [stage, router]);

  const beginCodex = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/codex/device/start", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `device start failed (${res.status})`);
      }
      const data = (await res.json()) as CodexDeviceState;
      void copyTextToClipboard(data.user_code);
      setCodexDevice(data);
      setStage("codex-device");
    } catch (err) {
      toast.error("Couldn't reach OpenAI", {
        description: err instanceof Error ? err.message : "device start failed",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!bootstrapped || stage !== "codex" || busy || codexDevice) {
      return;
    }
    void beginCodex();
  }, [bootstrapped, stage, busy, codexDevice, beginCodex]);

  useEffect(() => {
    if (stage !== "codex-device" || !codexDevice) {
      return;
    }
    let cancelled = false;
    let interval = codexDevice.interval * 1000;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) {
        return;
      }
      try {
        const res = await fetch("/api/codex/device/poll", { method: "POST" });
        const data = await res.json();
        if (cancelled) {
          return;
        }
        switch (data.status) {
          case "ok":
            if (data.user) {
              setCodexUser({ email: data.user.email, name: data.user.name });
            }
            setStage("codex-success");
            return;
          case "pending":
            pollTimer = setTimeout(poll, interval);
            return;
          case "slow_down":
            interval += 5000;
            pollTimer = setTimeout(poll, interval);
            return;
          case "expired":
            toast.error("Verification code expired", {
              description: "Restart the flow to get a fresh code.",
            });
            setStage("codex");
            return;
          default: {
            const reason = String(data.reason ?? "").toLowerCase();
            if (reason.includes("authorization") || reason.includes("denied")) {
              setShowDeviceAuthHint(true);
            }
            toast.error("ChatGPT login failed", { description: data.reason ?? undefined });
            setStage("codex");
            return;
          }
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        toast.error("Couldn't reach OpenAI", {
          description: err instanceof Error ? err.message : "polling failed",
        });
      }
    };

    pollTimer = setTimeout(poll, interval);
    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, codexDevice]);

  const beginSpectrum = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/oauth/device/start", { method: "POST" });
      if (!res.ok) {
        throw new Error((await res.json()).error ?? "device flow start failed");
      }
      const data = (await res.json()) as SpectrumDeviceState;
      void copyTextToClipboard(data.user_code);
      setSpectrumDevice(data);
      setStage("spectrum-device");
    } catch (err) {
      toast.error("Couldn't start authorization", {
        description: err instanceof Error ? err.message : "device flow start failed",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (stage !== "codex-success") {
      return;
    }
    const t = setTimeout(() => {
      void beginSpectrum();
    }, 900);
    return () => clearTimeout(t);
  }, [stage, beginSpectrum]);

  useEffect(() => {
    if (stage !== "spectrum-device" || !spectrumDevice) {
      return;
    }
    let cancelled = false;
    let interval = spectrumDevice.interval * 1000;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) {
        return;
      }
      try {
        const res = await fetch("/api/oauth/device/poll", { method: "POST" });
        const data = await res.json();
        if (cancelled) {
          return;
        }
        switch (data.status) {
          case "ok":
            setStage("phone");
            return;
          case "pending":
            pollTimer = setTimeout(poll, interval);
            return;
          case "slow_down":
            interval += 5000;
            pollTimer = setTimeout(poll, interval);
            return;
          case "denied":
            toast.error("Access denied", { description: "Try authorizing Spectrum again." });
            setStage("codex");
            return;
          case "expired":
            toast.error("Verification code expired", {
              description: "Restart the flow to get a fresh code.",
            });
            setStage("codex");
            return;
          default:
            toast.error("Device flow failed", { description: data.reason ?? undefined });
            setStage("codex");
            return;
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        toast.error("Couldn't reach Spectrum", {
          description: err instanceof Error ? err.message : "polling failed",
        });
      }
    };

    pollTimer = setTimeout(poll, interval);
    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
  }, [stage, spectrumDevice]);

  const provision = useCallback(async () => {
    if (!userPhone.trim()) {
      setStage("phone");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/provision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userPhone: userPhone.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        if (body.reason === "phone_conflict") {
          setStage("phone");
        } else if (body.reason === "codex_required") {
          setStage("codex");
        } else if (body.reason === "mfa_required") {
          setStage("mfa");
          // Don't show a generic error toast; the dedicated MFA panel
          // explains exactly what to do.
          return;
        } else if (body.reason === "github_required") {
          setStage("github");
          // Dedicated GitHub-required panel; suppress the generic toast.
          return;
        } else if (body.reason === "github_repo_required") {
          setStage("github-repo");
          // Dedicated GitHub-repo panel; suppress the generic toast.
          return;
        } else {
          setStage("codex");
        }
        throw new Error(body.error ?? `provision failed (${res.status})`);
      }
      await res.json();
      setStage("done");
    } catch (err) {
      toast.error("Couldn't provision", {
        description: err instanceof Error ? err.message : "provision failed",
      });
    } finally {
      setBusy(false);
    }
  }, [userPhone]);

  const activeIdx = STEP_INDEX[stage];

  if (!bootstrapped) {
    return (
      <div className="flex w-full max-w-[480px] flex-col items-center text-center">
        <div aria-hidden className="skeleton-chip" />
        <div aria-hidden className="mt-6 flex items-center gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span className="skeleton-dot" key={i} />
          ))}
        </div>
        <div aria-hidden className="skeleton-line mt-5 w-[60%]" />
        <div aria-hidden className="skeleton-line mt-3 w-[80%]" />
        <div className="sr-only">Loading</div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[480px] flex-col items-center text-center">
      <div className="fade-up fade-up-2" key={`icon-${stage}`}>
        <StageIcon stage={stage} />
      </div>

      <ProgressDots active={activeIdx} count={TOTAL_STEPS} />

      <div className="mt-5 flex flex-col items-center" key={stage}>
        <StageContent
          beginCodex={beginCodex}
          busy={busy}
          codexDevice={codexDevice}
          codexUser={codexUser}
          onPhoneSubmit={() => void provision()}
          setUserPhone={setUserPhone}
          showDeviceAuthHint={showDeviceAuthHint}
          spectrumDevice={spectrumDevice}
          stage={stage}
          userPhone={userPhone}
        />
      </div>
    </div>
  );
}

function StageIcon({ stage }: { stage: Stage }) {
  switch (stage) {
    case "codex":
    case "codex-device":
    case "mfa":
    case "github":
    case "github-repo":
      return <ChatGPTChip />;
    case "codex-success":
      return (
        <div className="relative">
          <ChatGPTChip />
          <span
            aria-hidden
            className="check-pop absolute -right-1 -bottom-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-text)] text-white shadow-[0_4px_14px_-4px_rgba(20,20,30,0.4)]"
          >
            <Check size={13} strokeWidth={3} />
          </span>
        </div>
      );
    case "spectrum-device":
    case "phone":
      return <SpectrumChip />;
    case "done":
      return <CodexIcon radius="18px" size="clamp(56px, 6.5vw, 68px)" />;
  }
}

function ProgressDots({ count, active }: { count: number; active: number }) {
  const slots = Array.from({ length: count }, (_, i) => `step-${i}`);
  return (
    <div aria-hidden className="fade-up fade-up-3 mt-6 flex items-center gap-1.5">
      {slots.map((id, i) => {
        const state = i < active ? "done" : i === active ? "active" : "idle";
        return (
          <span
            className={`h-1.5 rounded-full transition-all duration-500 ${
              state === "active"
                ? "w-6 bg-[var(--color-text)]"
                : state === "done"
                  ? "w-1.5 bg-[var(--color-text)] opacity-50"
                  : "w-1.5 bg-[var(--color-text)] opacity-15"
            }`}
            key={id}
          />
        );
      })}
    </div>
  );
}

interface StageContentProps {
  beginCodex: () => void;
  busy: boolean;
  codexDevice: CodexDeviceState | null;
  codexUser: { email: string | null; name: string | null } | null;
  onPhoneSubmit: () => void;
  setUserPhone: (v: string) => void;
  showDeviceAuthHint: boolean;
  spectrumDevice: SpectrumDeviceState | null;
  stage: Stage;
  userPhone: string;
}

function StageContent({
  stage,
  busy,
  beginCodex,
  codexDevice,
  codexUser,
  spectrumDevice,
  userPhone,
  setUserPhone,
  onPhoneSubmit,
  showDeviceAuthHint,
}: StageContentProps) {
  switch (stage) {
    case "codex":
      return (
        <CodexLandingStage
          busy={busy}
          onRetry={beginCodex}
          showDeviceAuthHint={showDeviceAuthHint}
        />
      );

    case "codex-success":
      return <CodexSuccessStage email={codexUser?.email ?? null} />;

    case "mfa":
      return <MfaRequiredStage busy={busy} onRelinkCodex={beginCodex} />;

    case "github":
      return <GithubRequiredStage busy={busy} onRelinkCodex={beginCodex} />;

    case "github-repo":
      return <GithubRepoRequiredStage busy={busy} onRecheck={onPhoneSubmit} />;

    case "codex-device":
      return (
        <>
          <h1 className="section-title fade-up fade-up-4 mt-4">Sign in with ChatGPT</h1>
          {codexDevice && <CodexDeviceCard device={codexDevice} />}
        </>
      );

    case "spectrum-device":
      return (
        <>
          <h1 className="section-title fade-up fade-up-4 mt-4">Connect Spectrum</h1>
          <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
            {codexUser?.email
              ? `Signed in as ${codexUser.email}. Now authorize Spectrum to provision your hosted iMessage line.`
              : "Authorize Spectrum to provision your hosted iMessage line."}
          </p>
          {spectrumDevice && <SpectrumDeviceCard device={spectrumDevice} />}
        </>
      );

    case "phone":
      return (
        <PhoneStage
          busy={busy}
          onSubmit={onPhoneSubmit}
          setUserPhone={setUserPhone}
          userPhone={userPhone}
        />
      );

    case "done":
      return (
        <>
          <h1 className="section-title fade-up fade-up-4 mt-4">All set</h1>
          <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
            Taking you to your dashboard&hellip;
          </p>
        </>
      );
  }
}

function PhoneStage({
  userPhone,
  setUserPhone,
  busy,
  onSubmit,
}: {
  userPhone: string;
  setUserPhone: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const [shaking, setShaking] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const initial = useMemo(() => splitE164(userPhone), [userPhone]);
  const [country, setCountry] = useState<Country>(initial.country);
  const [local, setLocal] = useState<string>(initial.local);

  const formatted = useMemo(() => {
    const digits = local.replace(/\D/g, "");
    if (!digits) {
      return "";
    }
    const t = new AsYouType(country.iso as CountryCode);
    const out = t.input(digits);
    return out || digits;
  }, [country, local]);

  useEffect(() => {
    const digits = local.replace(/\D/g, "");
    const next = digits ? `+${country.dial}${digits}` : "";
    if (next !== userPhone) {
      setUserPhone(next);
    }
  }, [country, local, setUserPhone, userPhone]);

  const e164 = `+${country.dial}${local.replace(/\D/g, "")}`;
  const phoneOk = e164.length > 1 ? isValidPhoneNumber(e164, country.iso as CountryCode) : false;

  const handleSubmit = () => {
    if (!phoneOk) {
      setAttempted(true);
      setShaking(true);
      setTimeout(() => setShaking(false), 420);
      toast.error("That doesn't look like a phone number", {
        description: "Enter a valid mobile number for your country.",
      });
      return;
    }
    onSubmit();
  };

  const phoneState: "valid" | "invalid" | "neutral" = phoneOk
    ? "valid"
    : attempted && local.length > 0
      ? "invalid"
      : "neutral";

  return (
    <>
      <h1 className="section-title fade-up fade-up-4 mt-4">Your phone</h1>
      <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
        Spectrum will assign you a shared iMessage number you can text from this phone.
      </p>
      <div className="fade-up fade-up-6 mt-7 w-full max-w-[28rem]">
        <form
          className={`flex w-full flex-col gap-3 ${shaking ? "shake" : ""}`}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <div
            className="input-glass relative flex h-[52px] items-stretch p-0 pr-10"
            data-state={phoneState === "neutral" ? undefined : phoneState}
          >
            <CountryDialPicker disabled={busy} onChange={setCountry} value={country} />
            <span
              aria-hidden
              className="flex select-none items-center pr-1 pl-3 font-mono text-[15px] text-[var(--color-text-muted)] tabular-nums"
            >
              +{country.dial}
            </span>
            <input
              aria-invalid={phoneState === "invalid" || undefined}
              aria-label="Phone number"
              autoComplete="tel-national"
              className="w-full bg-transparent pr-3 pl-1 text-left text-[15px] text-[var(--color-text)] tracking-[0.01em] outline-none placeholder:text-[var(--color-text-dim)]"
              disabled={busy}
              inputMode="tel"
              onChange={(e) => {
                setLocal(e.target.value.replace(/[^\d\s().-]/g, ""));
                if (attempted) {
                  setAttempted(false);
                }
              }}
              placeholder="000 000 0000"
              required
              spellCheck={false}
              type="tel"
              value={formatted}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
              {phoneState === "valid" ? (
                <Check className="text-[var(--color-success)]" size={16} />
              ) : phoneState === "invalid" ? (
                <AlertCircle className="text-[var(--color-danger)]" size={16} />
              ) : null}
            </span>
          </div>
          <button
            className="btn-pill-primary inline-flex w-full items-center justify-center"
            disabled={busy || local.length === 0}
            type="submit"
          >
            {busy ? <Loader2 className="mr-1.5 animate-spin" size={14} /> : null}
            Continue
            {!busy && <ArrowRight className="ml-1.5" size={14} />}
          </button>
          <p className="mt-3 max-w-[28rem] text-center text-[11.5px] text-[var(--color-text-muted)] leading-snug">
            By continuing you agree to the{" "}
            <a
              className="underline underline-offset-2 hover:text-[var(--color-text)]"
              href="https://github.com/photon-hq/codex/blob/main/docs/TERMS.md"
              rel="noopener noreferrer"
              target="_blank"
            >
              Terms
            </a>{" "}
            and{" "}
            <a
              className="underline underline-offset-2 hover:text-[var(--color-text)]"
              href="https://github.com/photon-hq/codex/blob/main/docs/PRIVACY.md"
              rel="noopener noreferrer"
              target="_blank"
            >
              Privacy Notice
            </a>
            . Unofficial bridge — not affiliated with OpenAI or Apple.
          </p>
        </form>
      </div>
    </>
  );
}

function splitE164(value: string): { country: Country; local: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { country: DEFAULT_COUNTRY, local: "" };
  }
  const parsed = parsePhoneNumberFromString(trimmed.startsWith("+") ? trimmed : `+${trimmed}`);
  if (parsed?.country) {
    const country = findByIso(parsed.country) ?? DEFAULT_COUNTRY;
    return { country, local: parsed.nationalNumber.toString() };
  }
  return { country: DEFAULT_COUNTRY, local: "" };
}

function CodexSuccessStage({ email }: { email: string | null }) {
  return (
    <>
      <h1 className="section-title fade-up fade-up-4 mt-4">ChatGPT connected</h1>
      <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
        {email ? (
          <>
            Signed in as <span className="font-mono text-[var(--color-text)]">{email}</span>.
            Reserving your iMessage line&hellip;
          </>
        ) : (
          <>Reserving your iMessage line&hellip;</>
        )}
      </p>
      <div className="fade-up fade-up-6 mt-7 flex items-center gap-2.5 text-[var(--color-text-muted)]">
        <Loader2 className="animate-spin" size={14} />
        <span className="body-small">One sec</span>
      </div>
    </>
  );
}

function MfaRequiredStage({
  busy,
  onRelinkCodex,
}: {
  busy: boolean;
  onRelinkCodex: () => void;
}) {
  return (
    <>
      <h1 className="section-title fade-up fade-up-4 mt-4">One more thing on ChatGPT</h1>
      <p className="body-muted fade-up fade-up-5 mt-2 max-w-[28rem] text-balance">
        Codex requires multi-factor authentication on this account before it'll accept
        device-code logins. We need you to turn on two settings, then re-link Codex.
      </p>

      <ol className="fade-up fade-up-6 mt-6 flex w-full max-w-[28rem] flex-col gap-3 text-left">
        <li className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border)] bg-white/40 px-3 py-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-text)] text-[11px] font-semibold text-white">
            1
          </span>
          <span className="body-small text-[var(--color-text)]">
            Open{" "}
            <a
              className="underline underline-offset-2 hover:text-[var(--color-text)]"
              href="https://chatgpt.com/#settings/Security"
              rel="noopener noreferrer"
              target="_blank"
            >
              chatgpt.com → Settings → Security
              <ExternalLink className="ml-0.5 inline" size={11} />
            </a>{" "}
            and enable <strong className="font-semibold">multi-factor authentication</strong>.
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border)] bg-white/40 px-3 py-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-text)] text-[11px] font-semibold text-white">
            2
          </span>
          <span className="body-small text-[var(--color-text)]">
            On the same page, enable{" "}
            <strong className="font-semibold">&ldquo;Sign in with device code&rdquo;</strong>.
            Without this, device-flow tokens don't carry the MFA claim Codex requires.
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border)] bg-white/40 px-3 py-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-text)] text-[11px] font-semibold text-white">
            3
          </span>
          <span className="body-small text-[var(--color-text)]">
            Come back here and click <strong className="font-semibold">Re-link Codex</strong>.
            We'll start a fresh sign-in that picks up the new settings.
          </span>
        </li>
      </ol>

      <div className="fade-up fade-up-7 mt-7 flex w-full max-w-[28rem] flex-col items-center gap-2">
        <button
          className="btn-pill-primary inline-flex items-center justify-center"
          disabled={busy}
          onClick={onRelinkCodex}
          type="button"
        >
          {busy ? (
            <>
              <Loader2 className="mr-1.5 animate-spin" size={14} />
              Starting…
            </>
          ) : (
            <>
              Re-link Codex
              <ArrowRight className="ml-1.5" size={14} />
            </>
          )}
        </button>
        <p className="body-small mt-1 max-w-[24rem] text-balance text-center">
          If your ChatGPT account is part of a workspace, your workspace admin may also need to
          allow device-code login.
        </p>
      </div>
    </>
  );
}

function GithubRequiredStage({
  busy,
  onRelinkCodex,
}: {
  busy: boolean;
  onRelinkCodex: () => void;
}) {
  return (
    <>
      <h1 className="section-title fade-up fade-up-4 mt-4">Connect GitHub to Codex</h1>
      <p className="body-muted fade-up fade-up-5 mt-2 max-w-[28rem] text-balance">
        Codex hasn't been linked to GitHub on this ChatGPT account yet — without it, Codex can't
        access a repo to work in. Connect GitHub first, then come back and re-link Codex.
      </p>

      <ol className="fade-up fade-up-6 mt-6 flex w-full max-w-[28rem] flex-col gap-3 text-left">
        <li className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border)] bg-white/40 px-3 py-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-text)] text-[11px] font-semibold text-white">
            1
          </span>
          <span className="body-small text-[var(--color-text)]">
            Open{" "}
            <a
              className="underline underline-offset-2 hover:text-[var(--color-text)]"
              href="https://chatgpt.com/codex/settings/environments"
              rel="noopener noreferrer"
              target="_blank"
            >
              chatgpt.com → Codex → Environments
              <ExternalLink className="ml-0.5 inline" size={11} />
            </a>{" "}
            and click <strong className="font-semibold">Connect GitHub</strong> to authorize Codex.
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border)] bg-white/40 px-3 py-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-text)] text-[11px] font-semibold text-white">
            2
          </span>
          <span className="body-small text-[var(--color-text)]">
            Pick at least one repository to link to a Codex environment. Codex will run tasks
            against that repo.
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border)] bg-white/40 px-3 py-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-text)] text-[11px] font-semibold text-white">
            3
          </span>
          <span className="body-small text-[var(--color-text)]">
            Come back here and click <strong className="font-semibold">Re-link Codex</strong>.
            We'll start a fresh sign-in that picks up the GitHub connection.
          </span>
        </li>
      </ol>

      <div className="fade-up fade-up-7 mt-7 flex w-full max-w-[28rem] flex-col items-center gap-2">
        <button
          className="btn-pill-primary inline-flex items-center justify-center"
          disabled={busy}
          onClick={onRelinkCodex}
          type="button"
        >
          {busy ? (
            <>
              <Loader2 className="mr-1.5 animate-spin" size={14} />
              Starting…
            </>
          ) : (
            <>
              Re-link Codex
              <ArrowRight className="ml-1.5" size={14} />
            </>
          )}
        </button>
      </div>
    </>
  );
}

function GithubRepoRequiredStage({
  busy,
  onRecheck,
}: {
  busy: boolean;
  onRecheck: () => void;
}) {
  return (
    <>
      <h1 className="section-title fade-up fade-up-4 mt-4">Add a repo to Codex</h1>
      <p className="body-muted fade-up fade-up-5 mt-2 max-w-[28rem] text-balance">
        Codex is connected to GitHub but no repository is attached to a Codex
        environment yet — without a repo, Codex has nothing to run tasks
        against. Pick a repo on chatgpt.com, then come back here.
      </p>

      <ol className="fade-up fade-up-6 mt-6 flex w-full max-w-[28rem] flex-col gap-3 text-left">
        <li className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border)] bg-white/40 px-3 py-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-text)] text-[11px] font-semibold text-white">
            1
          </span>
          <span className="body-small text-[var(--color-text)]">
            Open{" "}
            <a
              className="underline underline-offset-2 hover:text-[var(--color-text)]"
              href="https://chatgpt.com/codex/settings/environments"
              rel="noopener noreferrer"
              target="_blank"
            >
              chatgpt.com → Codex → Environments
              <ExternalLink className="ml-0.5 inline" size={11} />
            </a>
            .
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border)] bg-white/40 px-3 py-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-text)] text-[11px] font-semibold text-white">
            2
          </span>
          <span className="body-small text-[var(--color-text)]">
            Open your default environment and add at least one GitHub repository
            to it. This is the repo Codex will work in.
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border)] bg-white/40 px-3 py-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-text)] text-[11px] font-semibold text-white">
            3
          </span>
          <span className="body-small text-[var(--color-text)]">
            Come back here and click <strong className="font-semibold">Re-check</strong>.
            We'll verify Codex can see the repo, then continue to iMessage setup.
          </span>
        </li>
      </ol>

      <div className="fade-up fade-up-7 mt-7 flex w-full max-w-[28rem] flex-col items-center gap-2">
        <button
          className="btn-pill-primary inline-flex items-center justify-center"
          disabled={busy}
          onClick={onRecheck}
          type="button"
        >
          {busy ? (
            <>
              <Loader2 className="mr-1.5 animate-spin" size={14} />
              Checking…
            </>
          ) : (
            <>
              Re-check
              <ArrowRight className="ml-1.5" size={14} />
            </>
          )}
        </button>
        <p className="body-small mt-1 max-w-[24rem] text-balance text-center">
          Once you've added a repo at chatgpt.com, hit Re-check to confirm
          and continue.
        </p>
      </div>
    </>
  );
}

function CodexLandingStage({
  busy,
  onRetry,
  showDeviceAuthHint,
}: {
  busy: boolean;
  onRetry: () => void;
  showDeviceAuthHint: boolean;
}) {
  if (busy) {
    return null;
  }
  return (
    <>
      <h1 className="section-title fade-up fade-up-4 mt-4">Sign in with ChatGPT</h1>
      <div className="fade-up fade-up-6 mt-7 flex w-full max-w-[28rem] flex-col items-center gap-3">
        <button
          className="btn-pill-primary inline-flex items-center justify-center"
          onClick={onRetry}
          type="button"
        >
          Try again
          <ArrowRight className="ml-1.5" size={14} />
        </button>
        {showDeviceAuthHint && (
          <div className="fade-up mt-1 w-full rounded-[10px] border border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_10%,white)] px-3 py-2.5 text-left">
            <p className="text-[12px] text-[var(--color-text-muted)] leading-snug">
              <span className="font-medium text-[var(--color-text)]">
                Authorization Error from OpenAI?
              </span>{" "}
              Turn on{" "}
              <a
                className="underline underline-offset-2 hover:text-[var(--color-text)]"
                href="https://chatgpt.com/#settings/Security"
                rel="noreferrer"
                target="_blank"
              >
                Device code authorization for Codex
              </a>{" "}
              in ChatGPT Security settings, then try again.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function CodexDeviceCard({ device }: { device: CodexDeviceState }) {
  const openUrl = device.verification_uri_complete ?? device.verification_url;
  return (
    <DeviceCardLayout
      openUrl={openUrl}
      userCode={device.user_code}
      verificationHost={new URL(device.verification_url).host}
    />
  );
}

function SpectrumDeviceCard({ device }: { device: SpectrumDeviceState }) {
  const openUrl = device.verification_uri_complete ?? device.verification_uri;
  return (
    <DeviceCardLayout
      openUrl={openUrl}
      userCode={device.user_code}
      verificationHost={new URL(device.verification_uri).host}
    />
  );
}

function DeviceCardLayout({
  openUrl,
  verificationHost,
  userCode,
}: {
  openUrl: string;
  verificationHost: string;
  userCode: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      const ok = await copyTextToClipboard(userCode);
      if (!ok) {
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard may be unavailable (e.g., insecure context); user can tap to copy manually
    }
  }, [userCode]);

  useEffect(() => {
    void copy();
  }, [copy]);

  const half = Math.ceil(userCode.length / 2);
  const firstHalf = userCode.slice(0, half);
  const secondHalf = userCode.slice(half);

  return (
    <div className="fade-up fade-up-6 mt-8 flex w-full max-w-[28rem] flex-col items-center px-1">
      <div className="flex flex-col items-center">
        <span className="text-[11.5px] text-[var(--color-text-dim)] uppercase tracking-[0.12em]">
          {copied ? "Code copied — paste at the next step" : "Paste this code"}
        </span>
        <button
          aria-label="Copy verification code"
          className="group relative mt-2 rounded-lg font-medium font-mono text-[clamp(20px,5.2vw,28px)] text-[var(--color-text)] tabular-nums leading-none outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[rgba(0,0,0,0.2)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          onClick={copy}
          style={{ letterSpacing: "0.18em" }}
          type="button"
        >
          <span className="inline-flex items-baseline" style={{ paddingLeft: "0.18em" }}>
            <span>{firstHalf}</span>
            <span aria-hidden className="inline-block" style={{ width: "0.32em" }} />
            <span>{secondHalf}</span>
          </span>
          <span
            aria-hidden
            className={`pointer-events-none absolute top-1/2 -right-6 -translate-y-1/2 transition-opacity ${
              copied
                ? "text-[var(--color-text)] opacity-100"
                : "text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100"
            }`}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </span>
        </button>
      </div>

      <a
        className="btn-pill-primary mt-7 inline-flex max-w-full items-center gap-1.5"
        href={openUrl}
        onClick={() => {
          void copy();
        }}
        rel="noreferrer"
        target="_blank"
      >
        <span className="truncate">
          Continue on <span className="xs:inline hidden">{verificationHost}</span>
          <span className="xs:hidden">OpenAI</span>
        </span>
        <ExternalLink className="flex-shrink-0" size={13} />
      </a>
      <div className="mt-3 inline-flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)]">
        <Loader2 className="animate-spin" size={12} />
        <span>Waiting for you to approve&hellip;</span>
      </div>
    </div>
  );
}
