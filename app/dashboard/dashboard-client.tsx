"use client";

import { BackHomePill, CodexIcon, TopNav } from "@/components/chrome";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  MessageSquare,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface Me {
  provisioned: boolean;
  user?: { id: string; email?: string | null; name?: string | null };
  tenant?: {
    phoneNumber: string;
    redirectUri: string | null;
    codexLinked: boolean;
    codexUserEmail: string | null;
    codexEnvironmentId: string | null;
    codexEnvironmentBranch: string;
    codexModel: string;
    status: string;
    createdAt: string;
  };
}

export default function DashboardClient() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [reLinking, setReLinking] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tenant/me");
      if (res.status === 401) {
        router.replace("/onboard");
        return;
      }
      const data = (await res.json()) as Me;
      if (!data.provisioned || !data.tenant?.codexLinked) {
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

  const reLinkCodex = useCallback(async () => {
    setReLinking(true);
    try {
      const res = await fetch("/api/codex/device/start", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "device start failed");
      const data = await res.json();
      const url = data.verification_uri_complete ?? data.verification_url;
      window.open(url, "_blank", "noopener");
      toast.success("Open the OpenAI tab", {
        description: `Enter code ${data.user_code} to relink, then return here.`,
      });
    } catch (err) {
      toast.error("Couldn't start ChatGPT relink", {
        description: err instanceof Error ? err.message : "device start failed",
      });
    } finally {
      setReLinking(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/oauth/logout", { method: "POST" });
    router.replace("/");
  }, [router]);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/tenant/disconnect", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `disconnect failed (${res.status})`);
      }
      toast.success("Account disconnected", {
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
  }, [router]);

  if (loading) {
    return (
      <main className="relative flex flex-1 flex-col">
        <div className="safe-bottom flex w-full flex-1 flex-col items-center px-4 pb-16 pt-6 sm:px-8 sm:pb-20 sm:pt-10">
          <div className="flex w-full max-w-[520px] flex-col items-center text-center">
            <div className="skeleton-chip" aria-hidden />
            <div className="skeleton-line mt-6 w-[40%]" aria-hidden />
            <div className="skeleton-line mt-3 w-[70%] h-7" aria-hidden />
            <div className="skeleton-line mt-7 w-[50%]" aria-hidden />
            <div className="mt-12 grid w-full grid-cols-2 gap-3">
              <div className="skeleton-card" aria-hidden />
              <div className="skeleton-card" aria-hidden />
            </div>
            <div className="sr-only">Loading dashboard</div>
          </div>
        </div>
      </main>
    );
  }
  if (!me?.tenant) return null;

  const t = me.tenant;
  const codexUrl = "https://chatgpt.com/codex";

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
        <div className="safe-bottom flex w-full flex-1 flex-col items-center px-5 pb-20 pt-10 sm:px-8 sm:pt-16">
          <div className="flex w-full max-w-[480px] flex-col items-center text-center">
            <div className="fade-up fade-up-2">
              <CodexIcon size="clamp(52px, 6vw, 60px)" radius="16px" />
            </div>

            <div className="fade-up fade-up-3 mt-6 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
              <span className="dot dot-ok m-0" /> Active
            </div>

            <h1 className="fade-up fade-up-4 mt-6 font-mono text-[clamp(32px,5.2vw,44px)] font-medium leading-none tracking-[-0.02em] text-[var(--color-text)]">
              <CopyableNumber number={t.phoneNumber} />
            </h1>

            <p className="fade-up fade-up-5 mt-4 max-w-[28ch] text-[14px] leading-snug text-[var(--color-text-muted)]">
              Text this number from iMessage. Codex replies in the same thread.
            </p>

            <div className="fade-up fade-up-6 mt-8 flex w-full flex-col items-center gap-2.5">
              <a
                href={t.redirectUri ?? `sms:${t.phoneNumber}`}
                className="btn-pill-primary inline-flex items-center gap-1.5"
              >
                <MessageSquare size={14} /> Open in iMessage
              </a>
              <a
                href={codexUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] font-medium tracking-[-0.005em] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                Continue at chatgpt.com/codex ↗
              </a>
            </div>

            {!t.codexEnvironmentId && (
              <div className="fade-up fade-up-7 mt-10 w-full rounded-[12px] border border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_8%,white)] px-4 py-3 text-left">
                <p className="text-[13px] leading-snug text-[var(--color-text-muted)]">
                  <span className="font-medium text-[var(--color-text)]">Connect a repo.</span>{" "}
                  Codex needs a GitHub repo &mdash;{" "}
                  <a
                    href="https://chatgpt.com/codex/settings/environments"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    add one
                  </a>{" "}
                  before texting.
                </p>
              </div>
            )}

            <dl className="fade-up fade-up-7 mt-12 grid w-full grid-cols-2 gap-y-5 border-t border-[var(--color-border)] pt-8 text-left">
              <Row label="Model" value={t.codexModel} mono />
              <Row label="Active since" value={new Date(t.createdAt).toLocaleDateString()} />
              <Row
                label="ChatGPT"
                value={t.codexUserEmail ?? "linked"}
                truncate
                mono={!!t.codexUserEmail}
              />
              <Row
                label="Repo"
                value={t.codexEnvironmentId ? "Connected" : "Not connected"}
                muted={!t.codexEnvironmentId}
              />
            </dl>

            <div className="fade-up fade-up-7 mt-8 flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-3 text-[12.5px] font-medium tracking-[-0.005em] text-[var(--color-text-muted)]">
              <button
                type="button"
                onClick={reLinkCodex}
                disabled={reLinking}
                className="inline-flex items-center gap-1.5 hover:text-[var(--color-text)] disabled:opacity-60"
              >
                <RotateCcw size={12} /> {reLinking ? "Starting…" : "Re-link ChatGPT"}
              </button>
              <a
                href={codexUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-[var(--color-text)]"
              >
                <ExternalLink size={12} /> Codex on web
              </a>
              {!confirmDisconnect ? (
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(true)}
                  className="inline-flex items-center gap-1.5 text-[var(--color-danger)] hover:opacity-80"
                >
                  <Trash2 size={12} /> Disconnect
                </button>
              ) : (
                <span className="inline-flex items-center gap-2">
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
          </div>
        </div>
      </main>
    </>
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
      className="group inline-flex items-baseline gap-2 outline-none transition-opacity hover:opacity-85 focus-visible:opacity-85"
      aria-label="Copy phone number"
    >
      <span>{number}</span>
      <span
        className={`self-center text-[var(--color-text-muted)] transition-opacity ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        {copied ? <Check size={14} className="text-[var(--color-success)]" /> : <Copy size={14} />}
      </span>
    </button>
  );
}

function Row({
  label,
  value,
  mono,
  truncate,
  muted,
}: { label: string; value: string; mono?: boolean; truncate?: boolean; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-dim)]">
        {label}
      </dt>
      <dd
        className={`${mono ? "font-mono" : ""} ${
          muted ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]"
        } ${truncate ? "truncate" : ""} text-[13.5px] tracking-[-0.005em]`}
        title={truncate ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
