"use client";

import { Check, Copy, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CodexIcon, PageShell, TopNav } from "@/components/chrome";

interface Me {
  provisioned: boolean;
  tenant?: {
    phoneNumber: string;
    redirectUri: string | null;
    codexLinked: boolean;
    codexUserEmail: string | null;
    codexEnvironmentId: string | null;
    codexEnvironmentBranch: string;
    status: string;
    createdAt: string;
  };
  user?: { id: string; email?: string | null; name?: string | null };
}

export default function DashboardClient() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
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
      if (!(data.provisioned && data.tenant?.codexLinked)) {
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

  const needsRelink = me?.tenant?.status === "needs_relink";
  const tenantHref = me?.tenant ? (me.tenant.redirectUri ?? `sms:${me.tenant.phoneNumber}`) : null;

  useEffect(() => {
    // Don't auto-launch iMessage if the user can't actually use the bot —
    // the dashboard banner explains what to do instead.
    if (!tenantHref || needsRelink) {
      return;
    }
    try {
      if (window.sessionStorage.getItem("codex.imessageOpened") === "1") {
        return;
      }
      window.sessionStorage.setItem("codex.imessageOpened", "1");
    } catch {
      // sessionStorage might be unavailable; fall through and open once.
    }
    const handle = window.setTimeout(() => {
      window.location.href = tenantHref;
    }, 500);
    return () => window.clearTimeout(handle);
  }, [tenantHref]);

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
      <PageShell contentClassName="justify-center">
        <div className="flex w-full max-w-[480px] flex-col items-center text-center">
          <div aria-hidden className="skeleton-chip" />
          <div aria-hidden className="skeleton-line mt-6 w-[40%]" />
          <div aria-hidden className="skeleton-line mt-3 h-7 w-[70%]" />
          <div aria-hidden className="skeleton-line mt-7 w-[50%]" />
          <div className="sr-only">Loading dashboard</div>
        </div>
      </PageShell>
    );
  }
  if (!me?.tenant) {
    return null;
  }

  const t = me.tenant;

  return (
    <>
      <TopNav right={<span />} />
      <PageShell contentClassName="justify-center">
        <div className="flex w-full max-w-[480px] flex-col items-center gap-10 text-center">
          <div className="flex w-full flex-col items-center">
            <div className="fade-up fade-up-2">
              <CodexIcon radius="16px" size="clamp(52px, 6vw, 60px)" />
            </div>

            <h1 className="fade-up fade-up-4 mt-6 font-medium font-mono text-[clamp(32px,5.2vw,44px)] text-[var(--color-text)] leading-none tracking-[-0.02em]">
              <CopyableNumber number={t.phoneNumber} />
            </h1>

            <p className="fade-up fade-up-5 mt-4 max-w-[34ch] text-[14px] text-[var(--color-text-muted)] leading-snug">
              Opening iMessage now. If your browser blocked the jump, text this number manually from
              the Messages app — Codex replies in the same thread.
            </p>

            {t.status === "needs_relink" && (
              <div className="fade-up fade-up-7 mt-8 w-full rounded-[12px] border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_10%,white)] px-4 py-3 text-left">
                <p className="text-[13px] text-[var(--color-text-muted)] leading-snug">
                  <span className="font-medium text-[var(--color-text)]">
                    Re-link Codex.
                  </span>{" "}
                  Your ChatGPT sign-in for Codex expired or was revoked. iMessages to
                  this number will only get a re-link reminder until you sign in again.
                </p>
                <button
                  className="btn-pill-primary mt-3 inline-flex items-center justify-center"
                  onClick={() => router.push("/onboard")}
                  type="button"
                >
                  Re-link Codex
                </button>
              </div>
            )}

            {t.status !== "needs_relink" && !t.codexEnvironmentId && (
              <div className="fade-up fade-up-7 mt-8 w-full rounded-[12px] border border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_8%,white)] px-4 py-3 text-left">
                <p className="text-[13px] text-[var(--color-text-muted)] leading-snug">
                  <span className="font-medium text-[var(--color-text)]">Connect a repo.</span>{" "}
                  Codex needs a GitHub repo &mdash;{" "}
                  <a
                    className="underline underline-offset-2"
                    href="https://chatgpt.com/codex/settings/environments"
                    rel="noreferrer"
                    target="_blank"
                  >
                    add one
                  </a>{" "}
                  before texting.
                </p>
              </div>
            )}
          </div>

          <div className="fade-up fade-up-7 flex w-full items-center justify-center">
            {confirmDisconnect ? (
              <div className="inline-flex items-center gap-3">
                <button
                  className="btn-pill-primary inline-flex items-center justify-center disabled:cursor-progress"
                  disabled={disconnecting}
                  onClick={disconnect}
                  type="button"
                >
                  {disconnecting ? <Loader2 className="mr-1.5 animate-spin" size={14} /> : null}
                  {disconnecting ? "Disconnecting…" : "Confirm disconnect"}
                  {!disconnecting && <Trash2 className="ml-1.5" size={14} />}
                </button>
                <button
                  className="font-medium text-[12.5px] text-[var(--color-text-muted)] tracking-[-0.005em] hover:text-[var(--color-text)] disabled:opacity-60"
                  disabled={disconnecting}
                  onClick={() => setConfirmDisconnect(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn-pill-primary inline-flex items-center justify-center"
                onClick={() => setConfirmDisconnect(true)}
                type="button"
              >
                Disconnect
                <Trash2 className="ml-1.5" size={14} />
              </button>
            )}
          </div>
        </div>
      </PageShell>
    </>
  );
}

function CopyableNumber({ number }: { number: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label="Copy phone number"
      className="group inline-flex items-baseline gap-2 outline-none transition-opacity hover:opacity-85 focus-visible:opacity-85"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(number);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy", { description: "Clipboard access was denied." });
        }
      }}
      type="button"
    >
      <span>{number}</span>
      <span
        className={`self-center text-[var(--color-text-muted)] transition-opacity ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        {copied ? <Check className="text-[var(--color-success)]" size={14} /> : <Copy size={14} />}
      </span>
    </button>
  );
}
