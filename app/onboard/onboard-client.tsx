"use client";

import { ChatGPTChip, CodexIcon, SpectrumChip } from "@/components/chrome";
import { CountryDialPicker } from "@/components/country-dial-picker";
import { type Country, DEFAULT_COUNTRY, findByIso } from "@/lib/country-codes";
import {
  AsYouType,
  type CountryCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Stage = "codex" | "codex-device" | "codex-success" | "spectrum-device" | "phone" | "done";

interface CodexDeviceState {
  user_code: string;
  verification_url: string;
  verification_uri_complete: string | null;
  interval: number;
  expires_at: string;
}

interface SpectrumDeviceState {
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string | null;
  interval: number;
  expires_in: number;
}

interface TenantState {
  phoneNumber: string;
  redirectUri: string | null;
}

const STEP_INDEX: Record<Stage, number> = {
  codex: 0,
  "codex-device": 0,
  "codex-success": 0,
  "spectrum-device": 1,
  phone: 2,
  done: 3,
};
const TOTAL_STEPS = 4;

export default function OnboardClient() {
  const router = useRouter();
  const [bootstrapped, setBootstrapped] = useState(false);
  const [stage, setStage] = useState<Stage>("codex");
  const [userPhone, setUserPhone] = useState("");
  const [codexDevice, setCodexDevice] = useState<CodexDeviceState | null>(null);
  const [codexUser, setCodexUser] = useState<{ email: string | null; name: string | null } | null>(
    null,
  );
  const [spectrumDevice, setSpectrumDevice] = useState<SpectrumDeviceState | null>(null);
  const [tenant, setTenant] = useState<TenantState | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDeviceAuthHint, setShowDeviceAuthHint] = useState(false);

  useEffect(() => {
    void fetch("/api/tenant/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) {
          setBootstrapped(true);
          return;
        }
        if (data.provisioned && data.tenant.codexLinked) {
          router.replace("/dashboard");
          return;
        }
        if (data.provisioned) {
          setTenant({
            phoneNumber: data.tenant.phoneNumber,
            redirectUri: data.tenant.redirectUri ?? null,
          });
          setStage("codex");
        }
        setBootstrapped(true);
      })
      .catch(() => setBootstrapped(true));
  }, [router]);

  const beginCodex = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/codex/device/start", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `device start failed (${res.status})`);
      }
      const data = (await res.json()) as CodexDeviceState;
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
    if (stage !== "codex-device" || !codexDevice) return;
    let cancelled = false;
    let interval = codexDevice.interval * 1000;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch("/api/codex/device/poll", { method: "POST" });
        const data = await res.json();
        if (cancelled) return;
        switch (data.status) {
          case "ok":
            if (data.user) setCodexUser({ email: data.user.email, name: data.user.name });
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
        if (cancelled) return;
        toast.error("Couldn't reach OpenAI", {
          description: err instanceof Error ? err.message : "polling failed",
        });
      }
    };

    pollTimer = setTimeout(poll, interval);
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, codexDevice]);

  useEffect(() => {
    if (stage !== "codex-success") return;
    const t = setTimeout(() => {
      void beginSpectrum();
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const beginSpectrum = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/oauth/device/start", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "device flow start failed");
      const data = (await res.json()) as SpectrumDeviceState;
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
    if (stage !== "spectrum-device" || !spectrumDevice) return;
    let cancelled = false;
    let interval = spectrumDevice.interval * 1000;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch("/api/oauth/device/poll", { method: "POST" });
        const data = await res.json();
        if (cancelled) return;
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
        if (cancelled) return;
        toast.error("Couldn't reach Spectrum", {
          description: err instanceof Error ? err.message : "polling failed",
        });
      }
    };

    pollTimer = setTimeout(poll, interval);
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
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
        if (body.reason === "phone_conflict") setStage("phone");
        else if (body.reason === "codex_required") setStage("codex");
        else setStage("codex");
        throw new Error(body.error ?? `provision failed (${res.status})`);
      }
      const data = await res.json();
      setTenant({
        phoneNumber: data.phoneNumber,
        redirectUri: data.redirectUri ?? null,
      });
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
        <div className="skeleton-chip" aria-hidden />
        <div className="mt-6 flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skeleton-dot" />
          ))}
        </div>
        <div className="skeleton-line mt-5 w-[60%]" aria-hidden />
        <div className="skeleton-line mt-3 w-[80%]" aria-hidden />
        <div className="sr-only">Loading</div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[480px] flex-col items-center text-center">
      <div className="fade-up fade-up-2" key={`icon-${stage}`}>
        <StageIcon stage={stage} />
      </div>

      <ProgressDots count={TOTAL_STEPS} active={activeIdx} />

      <div className="mt-5 flex flex-col items-center" key={stage}>
        <StageContent
          stage={stage}
          busy={busy}
          beginCodex={beginCodex}
          codexDevice={codexDevice}
          codexUser={codexUser}
          spectrumDevice={spectrumDevice}
          tenant={tenant}
          userPhone={userPhone}
          setUserPhone={setUserPhone}
          onPhoneSubmit={() => void provision()}
          showDeviceAuthHint={showDeviceAuthHint}
        />
      </div>
    </div>
  );
}

function StageIcon({ stage }: { stage: Stage }) {
  switch (stage) {
    case "codex":
    case "codex-device":
      return <ChatGPTChip />;
    case "codex-success":
      return (
        <div className="relative">
          <ChatGPTChip />
          <span
            className="check-pop absolute -bottom-1 -right-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-white shadow-[0_4px_14px_-4px_rgba(16,163,127,0.7)]"
            style={{ background: "var(--color-success)" }}
            aria-hidden
          >
            <Check size={13} strokeWidth={3} />
          </span>
        </div>
      );
    case "spectrum-device":
    case "phone":
      return <SpectrumChip />;
    case "done":
      return <CodexIcon size="clamp(56px, 6.5vw, 68px)" radius="18px" />;
  }
}

function ProgressDots({ count, active }: { count: number; active: number }) {
  const slots = Array.from({ length: count }, (_, i) => `step-${i}`);
  return (
    <div className="fade-up fade-up-3 mt-6 flex items-center gap-1.5" aria-hidden>
      {slots.map((id, i) => {
        const state = i < active ? "done" : i === active ? "active" : "idle";
        return (
          <span
            key={id}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              state === "active"
                ? "w-6 bg-[var(--color-text)]"
                : state === "done"
                  ? "w-1.5 bg-[var(--color-text)] opacity-50"
                  : "w-1.5 bg-[var(--color-text)] opacity-15"
            }`}
          />
        );
      })}
    </div>
  );
}

interface StageContentProps {
  stage: Stage;
  busy: boolean;
  beginCodex: () => void;
  codexDevice: CodexDeviceState | null;
  codexUser: { email: string | null; name: string | null } | null;
  spectrumDevice: SpectrumDeviceState | null;
  tenant: TenantState | null;
  userPhone: string;
  setUserPhone: (v: string) => void;
  onPhoneSubmit: () => void;
  showDeviceAuthHint: boolean;
}

function StageContent({
  stage,
  busy,
  beginCodex,
  codexDevice,
  codexUser,
  spectrumDevice,
  tenant,
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
          onSubmit={beginCodex}
          showDeviceAuthHint={showDeviceAuthHint}
        />
      );

    case "codex-success":
      return <CodexSuccessStage email={codexUser?.email ?? null} />;

    case "codex-device":
      return (
        <>
          <h1 className="section-title fade-up fade-up-4 mt-4">Sign in with ChatGPT</h1>
          <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
            Open the link, then enter the code. We use your ChatGPT subscription — no API key
            needed.
          </p>
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
          userPhone={userPhone}
          setUserPhone={setUserPhone}
          busy={busy}
          onSubmit={onPhoneSubmit}
        />
      );

    case "done":
      return (
        <>
          <h1 className="section-title fade-up fade-up-4 mt-4">Opening iMessage&hellip;</h1>
          <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
            Bring Codex to your favorite thread &mdash; we&rsquo;re starting iMessage for you now.
          </p>
          {tenant && (
            <DonePanel phoneNumber={tenant.phoneNumber} redirectUri={tenant.redirectUri} />
          )}
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
    if (!digits) return "";
    const t = new AsYouType(country.iso as CountryCode);
    const out = t.input(digits);
    return out || digits;
  }, [country, local]);

  useEffect(() => {
    const digits = local.replace(/\D/g, "");
    const next = digits ? `+${country.dial}${digits}` : "";
    if (next !== userPhone) setUserPhone(next);
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
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          noValidate
        >
          <div
            className="input-glass relative flex h-[52px] items-stretch p-0 pr-10"
            data-state={phoneState === "neutral" ? undefined : phoneState}
          >
            <CountryDialPicker value={country} onChange={setCountry} disabled={busy} />
            <span
              aria-hidden
              className="flex select-none items-center pl-3 pr-1 font-mono text-[15px] tabular-nums text-[var(--color-text-muted)]"
            >
              +{country.dial}
            </span>
            <input
              className="w-full bg-transparent pl-1 pr-3 text-left text-[15px] tracking-[0.01em] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
              type="tel"
              inputMode="tel"
              placeholder="000 000 0000"
              autoComplete="tel-national"
              spellCheck={false}
              value={formatted}
              onChange={(e) => {
                setLocal(e.target.value.replace(/[^\d\s().-]/g, ""));
                if (attempted) setAttempted(false);
              }}
              disabled={busy}
              aria-label="Phone number"
              aria-invalid={phoneState === "invalid" || undefined}
              required
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              {phoneState === "valid" ? (
                <Check size={16} className="text-[var(--color-success)]" />
              ) : phoneState === "invalid" ? (
                <AlertCircle size={16} className="text-[var(--color-danger)]" />
              ) : null}
            </span>
          </div>
          <button
            type="submit"
            className="btn-pill-primary inline-flex w-full items-center justify-center"
            disabled={busy || local.length === 0}
          >
            {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Continue
            {!busy && <ArrowRight size={14} className="ml-1.5" />}
          </button>
        </form>
      </div>
    </>
  );
}

function splitE164(value: string): { country: Country; local: string } {
  const trimmed = value.trim();
  if (!trimmed) return { country: DEFAULT_COUNTRY, local: "" };
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
        <Loader2 size={14} className="animate-spin" />
        <span className="body-small">One sec</span>
      </div>
    </>
  );
}

function CodexLandingStage({
  busy,
  onSubmit,
  showDeviceAuthHint,
}: {
  busy: boolean;
  onSubmit: () => void;
  showDeviceAuthHint: boolean;
}) {
  return (
    <>
      <h1 className="section-title fade-up fade-up-4 mt-4">Connect ChatGPT</h1>
      <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
        Use your ChatGPT subscription &mdash; no API key. iMessage threads sync to
        chatgpt.com/codex.
      </p>
      <div className="fade-up fade-up-6 mt-7 w-full max-w-[28rem]">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="btn-pill-primary inline-flex w-full items-center justify-center"
        >
          {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          Continue with ChatGPT
          {!busy && <ArrowRight size={14} className="ml-1.5" />}
        </button>
        {showDeviceAuthHint && (
          <div className="fade-up mt-4 rounded-[10px] border border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_10%,white)] px-3 py-2.5 text-left">
            <p className="text-[12px] leading-snug text-[var(--color-text-muted)]">
              <span className="font-medium text-[var(--color-text)]">
                Authorization Error from OpenAI?
              </span>{" "}
              Turn on{" "}
              <a
                href="https://chatgpt.com/#settings/Security"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-[var(--color-text)]"
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
      verificationHost={new URL(device.verification_url).host}
      userCode={device.user_code}
    />
  );
}

function SpectrumDeviceCard({ device }: { device: SpectrumDeviceState }) {
  const openUrl = device.verification_uri_complete ?? device.verification_uri;
  return (
    <DeviceCardLayout
      openUrl={openUrl}
      verificationHost={new URL(device.verification_uri).host}
      userCode={device.user_code}
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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy", { description: "Clipboard access was denied." });
    }
  };
  const half = Math.ceil(userCode.length / 2);
  const firstHalf = userCode.slice(0, half);
  const secondHalf = userCode.slice(half);

  return (
    <div className="fade-up fade-up-6 mt-8 flex w-full max-w-[28rem] flex-col items-center px-1">
      <a
        href={openUrl}
        target="_blank"
        rel="noreferrer"
        className="btn-pill-primary inline-flex max-w-full items-center gap-1.5"
      >
        <span className="truncate">
          Continue on <span className="hidden xs:inline">{verificationHost}</span>
          <span className="xs:hidden">OpenAI</span>
        </span>
        <ExternalLink size={13} className="flex-shrink-0" />
      </a>
      <div className="mt-3 inline-flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)]">
        <Loader2 size={12} className="animate-spin" />
        <span>Waiting for you to approve&hellip;</span>
      </div>

      <div className="mt-7 flex flex-col items-center">
        <span className="text-[11.5px] uppercase tracking-[0.12em] text-[var(--color-text-dim)]">
          Paste this code
        </span>
        <button
          type="button"
          onClick={copy}
          className="group relative mt-2 rounded-lg font-mono text-[clamp(20px,5.2vw,28px)] font-medium leading-none tabular-nums text-[var(--color-text)] outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[rgba(0,0,0,0.2)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          style={{ letterSpacing: "0.18em" }}
          aria-label="Copy verification code"
        >
          <span className="inline-flex items-baseline" style={{ paddingLeft: "0.18em" }}>
            <span>{firstHalf}</span>
            <span aria-hidden className="inline-block" style={{ width: "0.32em" }} />
            <span>{secondHalf}</span>
          </span>
          <span
            aria-hidden
            className={`pointer-events-none absolute -right-6 top-1/2 -translate-y-1/2 transition-opacity ${
              copied
                ? "opacity-100 text-[var(--color-success)]"
                : "opacity-0 text-[var(--color-text-muted)] group-hover:opacity-100"
            }`}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </span>
        </button>
      </div>
    </div>
  );
}

function DonePanel({
  phoneNumber,
  redirectUri,
}: {
  phoneNumber: string;
  redirectUri: string | null;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phoneNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy", { description: "Clipboard access was denied." });
    }
  };

  const openImessage = useCallback(() => {
    if (!redirectUri) return;
    window.location.href = redirectUri;
  }, [redirectUri]);

  useEffect(() => {
    if (!redirectUri) return;
    const t = window.setTimeout(openImessage, 400);
    return () => window.clearTimeout(t);
  }, [redirectUri, openImessage]);

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/tenant/disconnect", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `disconnect failed (${res.status})`);
      }
      toast.success("Disconnected", {
        description: "Your iMessage line and ChatGPT link have been removed.",
      });
      router.replace("/onboard");
    } catch (err) {
      toast.error("Couldn't disconnect", {
        description: err instanceof Error ? err.message : "disconnect failed",
      });
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="fade-up fade-up-6 group mt-7 inline-flex items-baseline gap-2 font-mono text-[clamp(32px,5.2vw,44px)] font-medium leading-none tracking-[-0.02em] text-[var(--color-text)] outline-none transition-opacity hover:opacity-85"
        aria-label="Copy phone number"
      >
        <span>{phoneNumber}</span>
        <span
          className={`self-center text-[var(--color-text-muted)] transition-opacity ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          {copied ? (
            <Check size={14} className="text-[var(--color-success)]" />
          ) : (
            <Copy size={14} />
          )}
        </span>
      </button>
      <div className="fade-up fade-up-7 mt-8 flex w-full max-w-[28rem] flex-col items-center gap-3 text-center">
        <p className="text-[13.5px] leading-snug text-[var(--color-text-muted)]">
          Sometimes your browser blocks the jump to iMessage. If nothing opened in a moment, text{" "}
          <span className="font-medium text-[var(--color-text)]">{phoneNumber}</span> manually from
          the Messages app to start the thread.
        </p>
        {redirectUri && (
          <button
            type="button"
            onClick={openImessage}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium tracking-[-0.005em] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <MessageSquare size={12} /> Try opening iMessage again
          </button>
        )}
        <Link
          href="/dashboard"
          className="text-[12.5px] font-medium tracking-[-0.005em] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          Go to dashboard &rarr;
        </Link>
      </div>
      <div className="fade-up fade-up-7 mt-10 flex w-full max-w-[24rem] items-center justify-center gap-x-5 border-t border-[var(--color-border)] pt-6 text-[12.5px] font-medium tracking-[-0.005em] text-[var(--color-text-muted)]">
        {!confirmDisconnect ? (
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            className="inline-flex items-center gap-1.5 text-[var(--color-danger)] hover:opacity-80"
          >
            <Trash2 size={12} /> Disconnect
          </button>
        ) : (
          <span className="inline-flex items-center gap-x-5">
            <button
              type="button"
              onClick={disconnect}
              disabled={disconnecting}
              className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-danger)] hover:opacity-80 disabled:opacity-60"
            >
              {disconnecting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              {disconnecting ? "Disconnecting…" : "Confirm disconnect"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDisconnect(false)}
              disabled={disconnecting}
              className="hover:text-[var(--color-text)]"
            >
              Cancel
            </button>
          </span>
        )}
      </div>
    </>
  );
}
