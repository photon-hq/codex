"use client";

import { BackHomePill, CodexIcon, TopNav } from "@/components/chrome";
import { isOpenAIKeyShape } from "@/lib/openai-key";
import { AlertCircle, Check, Copy, KeyRound, LogOut, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface Me {
  provisioned: boolean;
  user?: { id: string; email?: string | null; name?: string | null };
  tenant?: {
    phoneNumber: string;
    redirectUri: string | null;
    hasOpenAIKey: boolean;
    codexModel: string;
    status: string;
    createdAt: string;
  };
}

export default function DashboardClient() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [rotating, setRotating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tenant/me");
      if (res.status === 401) {
        router.replace("/onboard");
        return;
      }
      const data = (await res.json()) as Me;
      if (!data.provisioned || !data.tenant?.hasOpenAIKey) {
        router.replace("/onboard");
        return;
      }
      setMe(data);
    } catch (err) {
      toast.error("Couldn't load dashboard", {
        description: err instanceof Error ? err.message : "failed to load",
      });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rotateKey = useCallback(async () => {
    if (!isOpenAIKeyShape(newKey.trim())) return;
    setRotating(true);
    try {
      const res = await fetch("/api/tenant/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: newKey.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "rotation failed");
      setNewKey("");
      await refresh();
    } catch (err) {
      toast.error("Couldn't replace key", {
        description: err instanceof Error ? err.message : "rotation failed",
      });
    } finally {
      setRotating(false);
    }
  }, [newKey, refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/oauth/logout", { method: "POST" });
    router.replace("/");
  }, [router]);

  if (loading) {
    return <div className="body-small text-[var(--color-text-muted)]">Loading…</div>;
  }
  if (!me?.tenant) return null;

  return (
    <>
      <TopNav
        left={<BackHomePill />}
        right={
          <button
            type="button"
            onClick={logout}
            className="btn-pill-secondary nav-link inline-flex items-center gap-1.5"
            style={{ padding: "0.4375rem 0.875rem", fontSize: "13px" }}
          >
            <LogOut size={12} /> Sign out
          </button>
        }
      />
      <main className="relative flex flex-1 flex-col">
        <div className="flex w-full flex-1 flex-col items-center px-5 pb-16 pt-6 sm:px-8 sm:pb-20 sm:pt-10">
          <div className="flex w-full max-w-[520px] flex-col items-center text-center">
            <div className="fade-up fade-up-2">
              <CodexIcon size="clamp(56px, 6.5vw, 68px)" radius="18px" />
            </div>

            <div className="fade-up fade-up-3 mt-5 inline-flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
              <span className="dot dot-ok" /> Active
            </div>

            <span className="eyebrow fade-up fade-up-4 mt-5">Your Codex iMessage number</span>
            <CopyableNumber number={me.tenant.phoneNumber} />

            <div className="fade-up fade-up-6 mt-7 flex flex-col items-center gap-3">
              {me.tenant.redirectUri && (
                <a
                  href={me.tenant.redirectUri}
                  className="btn-pill-primary inline-flex items-center gap-1.5"
                >
                  <MessageSquare size={14} /> Open in iMessage
                </a>
              )}
              <a
                href={`sms:${me.tenant.phoneNumber}`}
                className="text-[13px] font-medium tracking-[-0.01em] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                Open as sms:// link
              </a>
            </div>

            <div className="fade-up fade-up-7 mt-12 grid w-full grid-cols-2 gap-3">
              <InfoTile label="Model" value={me.tenant.codexModel} mono />
              <InfoTile
                label="Active since"
                value={new Date(me.tenant.createdAt).toLocaleDateString()}
              />
            </div>

            <details className="fade-up fade-up-7 mt-3 w-full rounded-[14px] border border-white/40 bg-white/40 p-4 text-left backdrop-blur transition-all open:bg-white/60 sm:p-5">
              <summary className="cursor-pointer list-none text-[14px] font-medium tracking-[-0.01em] text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
                How it works
              </summary>
              <ul className="mt-3 flex flex-col gap-2 body-small">
                <li>
                  <span className="text-[var(--color-text)]">Text the number above.</span> Codex
                  replies in the same thread.
                </li>
                <li>
                  Send <span className="kbd">/new</span> to start a fresh conversation. Previous
                  turns are forgotten.
                </li>
                <li>
                  Text only for now. Voice notes, attachments, and reactions get a polite &ldquo;not
                  yet&rdquo;.
                </li>
              </ul>
            </details>

            <details className="fade-up fade-up-7 mt-3 w-full rounded-[14px] border border-white/40 bg-white/40 p-4 text-left backdrop-blur transition-all open:bg-white/60 sm:p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-medium tracking-[-0.01em] text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                  <KeyRound size={14} /> OpenAI key
                </span>
                <span className="body-small text-[var(--color-text-muted)]">Rotate</span>
              </summary>
              <p className="mt-3 body-small text-[var(--color-text-dim)]">
                Stored AES-256-GCM encrypted. Revoking on platform.openai.com takes effect instantly
                — the bot will error until you rotate.
              </p>
              <RotateKeyForm
                newKey={newKey}
                setNewKey={setNewKey}
                rotating={rotating}
                onSubmit={rotateKey}
              />
            </details>
          </div>
        </div>
      </main>
    </>
  );
}

function RotateKeyForm({
  newKey,
  setNewKey,
  rotating,
  onSubmit,
}: {
  newKey: string;
  setNewKey: (v: string) => void;
  rotating: boolean;
  onSubmit: () => void;
}) {
  const [attempted, setAttempted] = useState(false);
  const trimmed = newKey.trim();
  const isValid = useMemo(() => isOpenAIKeyShape(trimmed), [trimmed]);
  const isEmpty = trimmed.length === 0;
  const state: "valid" | "invalid" | "neutral" = isValid
    ? "valid"
    : attempted && !isEmpty
      ? "invalid"
      : "neutral";

  const handleSubmit = () => {
    if (!isValid) {
      setAttempted(true);
      toast.error("That doesn't look like an OpenAI key", {
        description: "Keys start with sk- and are at least 40 characters.",
      });
      return;
    }
    onSubmit();
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="relative">
        <input
          type="password"
          inputMode="text"
          className="input-glass font-mono pr-10"
          placeholder="sk-..."
          autoComplete="off"
          spellCheck={false}
          value={newKey}
          onChange={(e) => {
            setNewKey(e.target.value);
            if (attempted) setAttempted(false);
          }}
          aria-label="New OpenAI API key"
          aria-invalid={state === "invalid" || undefined}
          data-state={state === "neutral" ? undefined : state}
          minLength={40}
          maxLength={400}
          pattern="^sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}$"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          {state === "valid" ? (
            <Check size={16} className="text-[var(--color-success)]" />
          ) : state === "invalid" ? (
            <AlertCircle size={16} className="text-[var(--color-danger)]" />
          ) : null}
        </span>
      </div>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          className="btn-pill-primary inline-flex items-center"
          disabled={rotating || isEmpty}
          onClick={handleSubmit}
        >
          Replace key
        </button>
        <button
          type="button"
          className="btn-pill-secondary inline-flex items-center"
          onClick={() => setNewKey("")}
          disabled={rotating || isEmpty}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function CopyableNumber({ number }: { number: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(number);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy", { description: "Clipboard access was denied." });
        }
      }}
      className="fade-up fade-up-5 group mt-2 inline-flex items-center gap-2"
      aria-label="Copy phone number"
    >
      <span className="font-mono text-[clamp(28px,3.6vw,40px)] font-medium tracking-[-0.01em] text-[var(--color-text)]">
        {number}
      </span>
      <span
        className={`text-[var(--color-text-muted)] transition-opacity ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        {copied ? <Check size={16} className="text-[var(--color-success)]" /> : <Copy size={16} />}
      </span>
    </button>
  );
}

function InfoTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[14px] border border-white/40 bg-white/40 p-3 text-left backdrop-blur sm:p-4">
      <div className="eyebrow">{label}</div>
      <div
        className={`mt-1 ${
          mono
            ? "font-mono text-[13px] text-[var(--color-text)]"
            : "text-[13px] text-[var(--color-text)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
