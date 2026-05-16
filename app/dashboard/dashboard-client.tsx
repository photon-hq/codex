"use client";

import { BackHomePill, CodexIcon, TopNav } from "@/components/chrome";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";
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

  const tenantHref = me?.tenant ? (me.tenant.redirectUri ?? `sms:${me.tenant.phoneNumber}`) : null;

  useEffect(() => {
    if (!tenantHref) return;
    try {
      if (window.sessionStorage.getItem("codex.imessageOpened") === "1") return;
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

  return (
    <>
      <TopNav left={<BackHomePill />} right={<span />} />
      <main className="relative flex flex-1 flex-col">
        <div className="safe-bottom flex w-full flex-1 flex-col items-center px-5 pb-10 pt-10 sm:px-8 sm:pt-16">
          <div className="flex w-full max-w-[480px] flex-col items-center text-center">
            <div className="fade-up fade-up-2">
              <CodexIcon size="clamp(52px, 6vw, 60px)" radius="16px" />
            </div>

            <h1 className="fade-up fade-up-4 mt-6 font-mono text-[clamp(32px,5.2vw,44px)] font-medium leading-none tracking-[-0.02em] text-[var(--color-text)]">
              <CopyableNumber number={t.phoneNumber} />
            </h1>

            <p className="fade-up fade-up-5 mt-4 max-w-[34ch] text-[14px] leading-snug text-[var(--color-text-muted)]">
              Opening iMessage now. If your browser blocked the jump, text this number manually from
              the Messages app — Codex replies in the same thread.
            </p>

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
          </div>

          <div className="fade-up fade-up-7 mt-auto flex w-full items-center justify-center pt-12">
            {!confirmDisconnect ? (
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                className="btn-pill-primary inline-flex items-center justify-center"
              >
                Disconnect
                <Trash2 size={14} className="ml-1.5" />
              </button>
            ) : (
              <div className="inline-flex items-center gap-3">
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={disconnecting}
                  className="btn-pill-primary inline-flex items-center justify-center disabled:cursor-progress"
                >
                  {disconnecting ? (
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                  ) : null}
                  {disconnecting ? "Disconnecting…" : "Confirm disconnect"}
                  {!disconnecting && <Trash2 size={14} className="ml-1.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(false)}
                  disabled={disconnecting}
                  className="text-[12.5px] font-medium tracking-[-0.005em] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            )}
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
