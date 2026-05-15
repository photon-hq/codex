"use client";

import { ChatGPTChip, CodexIcon, SpectrumChip } from "@/components/chrome";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Stage = "codex" | "codex-device" | "spectrum-device" | "details" | "provision" | "done";

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

interface SessionUser {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

const STEP_INDEX: Record<Stage, number> = {
  codex: 0,
  "codex-device": 0,
  "spectrum-device": 1,
  details: 2,
  provision: 2,
  done: 3,
};
const TOTAL_STEPS = 4;

export default function OnboardClient() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("codex");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [, setSessionUser] = useState<SessionUser | null>(null);
  const [codexDevice, setCodexDevice] = useState<CodexDeviceState | null>(null);
  const [codexUser, setCodexUser] = useState<{ email: string | null; name: string | null } | null>(
    null,
  );
  const [spectrumDevice, setSpectrumDevice] = useState<SpectrumDeviceState | null>(null);
  const [tenant, setTenant] = useState<TenantState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/tenant/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.provisioned && data.tenant.codexLinked) {
          router.replace("/dashboard");
          return;
        }
        if (data.provisioned) {
          setTenant({
            phoneNumber: data.tenant.phoneNumber,
            redirectUri: data.tenant.redirectUri ?? null,
          });
          setStage("done");
        }
      })
      .catch(() => {});
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
            void beginSpectrum();
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
          default:
            toast.error("ChatGPT login failed", { description: data.reason ?? undefined });
            setStage("codex");
            return;
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
            if (data.user) {
              const u = data.user as SessionUser;
              setSessionUser(u);
              if (u.firstName) setFirstName(u.firstName);
              if (u.lastName) setLastName(u.lastName);
            }
            setStage("details");
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

  useEffect(() => {
    if (stage !== "provision") return;
    if (!userPhone.trim() || !firstName.trim() || !lastName.trim()) {
      setStage("details");
      return;
    }
    let cancelled = false;
    setBusy(true);
    void fetch("/api/provision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userPhone: userPhone.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const reason = body.reason as string | undefined;
          if (reason === "phone_conflict") setStage("details");
          else if (reason === "codex_required") setStage("codex");
          else setStage("codex");
          throw new Error(body.error ?? `provision failed (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        setTenant({
          phoneNumber: data.phoneNumber,
          redirectUri: data.redirectUri ?? null,
        });
        setStage("done");
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error("Couldn't provision", {
          description: err instanceof Error ? err.message : "provision failed",
        });
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stage, userPhone, firstName, lastName]);

  const activeIdx = STEP_INDEX[stage];

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
          firstName={firstName}
          setFirstName={setFirstName}
          lastName={lastName}
          setLastName={setLastName}
          userPhone={userPhone}
          setUserPhone={setUserPhone}
          onDetailsSubmit={() => setStage("provision")}
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
    case "spectrum-device":
    case "details":
      return <SpectrumChip />;
    case "provision":
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
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  userPhone: string;
  setUserPhone: (v: string) => void;
  onDetailsSubmit: () => void;
}

function StageContent({
  stage,
  busy,
  beginCodex,
  codexDevice,
  codexUser,
  spectrumDevice,
  tenant,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  userPhone,
  setUserPhone,
  onDetailsSubmit,
}: StageContentProps) {
  switch (stage) {
    case "codex":
      return <CodexLandingStage busy={busy} onSubmit={beginCodex} />;

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

    case "details":
      return (
        <DetailsStage
          firstName={firstName}
          setFirstName={setFirstName}
          lastName={lastName}
          setLastName={setLastName}
          userPhone={userPhone}
          setUserPhone={setUserPhone}
          busy={busy}
          onSubmit={onDetailsSubmit}
        />
      );

    case "provision":
      return (
        <>
          <h1 className="section-title fade-up fade-up-4 mt-4">Provisioning</h1>
          <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
            Spinning up your project, enabling iMessage, and reserving a number.
          </p>
          <div className="fade-up fade-up-6 mt-7 flex items-center gap-2.5 text-[var(--color-text-muted)]">
            <Loader2 size={16} className="animate-spin" />
            <span className="body-small">Hang tight&hellip;</span>
          </div>
        </>
      );

    case "done":
      return (
        <>
          <h1 className="section-title fade-up fade-up-4 mt-4">You&rsquo;re live</h1>
          <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
            Text the number below from any iPhone — Codex picks up instantly and replies sync to
            chatgpt.com/codex.
          </p>
          {tenant && (
            <DonePanel phoneNumber={tenant.phoneNumber} redirectUri={tenant.redirectUri} />
          )}
        </>
      );
  }
}

function DetailsStage({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  userPhone,
  setUserPhone,
  busy,
  onSubmit,
}: {
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  userPhone: string;
  setUserPhone: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const [shaking, setShaking] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const trimmedPhone = userPhone.trim();
  const phoneOk = useMemo(() => /^\+[1-9]\d{6,14}$/.test(trimmedPhone), [trimmedPhone]);
  const nameOk = firstName.trim().length > 0 && lastName.trim().length > 0;
  const isValid = phoneOk && nameOk;
  const isEmpty = trimmedPhone.length === 0 || !nameOk;

  const handleSubmit = () => {
    if (!isValid) {
      setAttempted(true);
      setShaking(true);
      setTimeout(() => setShaking(false), 420);
      if (!nameOk) {
        toast.error("Add your name", { description: "Both first and last name are required." });
      } else {
        toast.error("That doesn't look like a phone number", {
          description: "Use E.164 format, e.g. +14155550123.",
        });
      }
      return;
    }
    onSubmit();
  };

  const phoneState: "valid" | "invalid" | "neutral" = phoneOk
    ? "valid"
    : attempted && trimmedPhone.length > 0
      ? "invalid"
      : "neutral";

  return (
    <>
      <h1 className="section-title fade-up fade-up-4 mt-4">Your details</h1>
      <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
        Spectrum needs this to assign you a shared iMessage number you can text.
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
          <div className="grid grid-cols-2 gap-3">
            <input
              className="input-glass text-[15px]"
              type="text"
              placeholder="First name"
              autoComplete="given-name"
              spellCheck={false}
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                if (attempted) setAttempted(false);
              }}
              disabled={busy}
              aria-label="First name"
              required
            />
            <input
              className="input-glass text-[15px]"
              type="text"
              placeholder="Last name"
              autoComplete="family-name"
              spellCheck={false}
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                if (attempted) setAttempted(false);
              }}
              disabled={busy}
              aria-label="Last name"
              required
            />
          </div>
          <div className="relative">
            <input
              className="input-glass font-mono text-center text-[15px] tracking-[0.02em] pr-10"
              type="tel"
              inputMode="tel"
              placeholder="+14155550123"
              autoComplete="tel"
              spellCheck={false}
              value={userPhone}
              onChange={(e) => {
                setUserPhone(e.target.value);
                if (attempted) setAttempted(false);
              }}
              disabled={busy}
              aria-label="Phone number (E.164)"
              aria-invalid={phoneState === "invalid" || undefined}
              data-state={phoneState === "neutral" ? undefined : phoneState}
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
            disabled={busy || isEmpty}
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

function CodexLandingStage({ busy, onSubmit }: { busy: boolean; onSubmit: () => void }) {
  return (
    <>
      <h1 className="section-title fade-up fade-up-4 mt-4">Sign in with ChatGPT</h1>
      <p className="body-muted fade-up fade-up-5 mt-2 max-w-[24rem] text-balance">
        Codex on iMessage uses your ChatGPT subscription. Replies sync to chatgpt.com/codex so you
        can pick up any thread on the web.
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
        <p className="mt-3 text-[12px] text-[var(--color-text-dim)]">
          You&rsquo;ll get a one-time code to enter at{" "}
          <span className="font-mono">auth.openai.com/codex/device</span>.
        </p>
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
    <div className="fade-up fade-up-6 mt-8 flex w-full max-w-[28rem] flex-col items-center">
      <a
        href={openUrl}
        target="_blank"
        rel="noreferrer"
        className="btn-pill-primary inline-flex items-center gap-1.5"
      >
        Continue on {verificationHost}
        <ExternalLink size={13} />
      </a>
      <div className="mt-3 inline-flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)]">
        <Loader2 size={12} className="animate-spin" />
        <span>Waiting for you to approve&hellip;</span>
      </div>

      <div className="mt-7 flex flex-col items-center">
        <span className="text-[11.5px] uppercase tracking-[0.12em] text-[var(--color-text-dim)]">
          If asked, paste this code
        </span>
        <button
          type="button"
          onClick={copy}
          className="group relative mt-2 rounded-lg font-mono text-[clamp(22px,2.6vw,28px)] font-medium leading-none tabular-nums text-[var(--color-text)] outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[rgba(0,0,0,0.2)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
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
            className={`pointer-events-none absolute -right-7 top-1/2 -translate-y-1/2 transition-opacity ${
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
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phoneNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy", { description: "Clipboard access was denied." });
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="fade-up fade-up-6 group mt-8 inline-flex items-center gap-2 font-mono text-[clamp(28px,3.6vw,40px)] font-medium tracking-[-0.01em] text-[var(--color-text)]"
        aria-label="Copy phone number"
      >
        {phoneNumber}
        <span
          className={`text-[var(--color-text-muted)] transition-opacity ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          {copied ? (
            <Check size={16} className="text-[var(--color-success)]" />
          ) : (
            <Copy size={16} />
          )}
        </span>
      </button>
      <div className="fade-up fade-up-7 mt-7 flex flex-col items-center gap-3">
        {redirectUri && (
          <a href={redirectUri} className="btn-pill-primary inline-flex items-center gap-1.5">
            <MessageSquare size={14} /> Open in iMessage
          </a>
        )}
        <Link
          href="/dashboard"
          className="text-[13px] font-medium tracking-[-0.01em] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          Go to dashboard &rarr;
        </Link>
      </div>
    </>
  );
}
