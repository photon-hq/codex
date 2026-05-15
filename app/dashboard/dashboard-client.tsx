"use client";

import { BackHomePill, CodexIcon, TopNav } from "@/components/chrome";
import {
  Check,
  ChevronDown,
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
        <div className="safe-bottom flex w-full flex-1 flex-col items-center px-4 pb-16 pt-6 sm:px-8 sm:pb-20 sm:pt-10">
          <div className="flex w-full max-w-[520px] flex-col items-center text-center">
            <div className="fade-up fade-up-2">
              <CodexIcon size="clamp(56px, 6.5vw, 68px)" radius="18px" />
            </div>

            <div className="fade-up fade-up-3 mt-5 inline-flex items-center gap-2 rounded-full bg-white/55 px-2.5 py-1 text-[11.5px] font-medium tracking-[-0.005em] text-[var(--color-text-muted)] shadow-[0_1px_0_rgba(255,255,255,0.6)_inset]">
              <span className="dot dot-ok m-0" /> Active
            </div>

            <span className="eyebrow fade-up fade-up-4 mt-5">Your Codex iMessage number</span>
            <CopyableNumber number={t.phoneNumber} />

            <div className="fade-up fade-up-6 mt-7 flex flex-col items-center gap-2">
              <a
                href={t.redirectUri ?? `sms:${t.phoneNumber}`}
                className="btn-pill-primary inline-flex items-center gap-1.5"
              >
                <MessageSquare size={14} /> Open in iMessage
              </a>
            </div>

            <div className="fade-up fade-up-7 mt-12 grid w-full grid-cols-2 gap-3">
              <InfoTile label="Model" value={t.codexModel} mono />
              <InfoTile label="Active since" value={new Date(t.createdAt).toLocaleDateString()} />
            </div>

            <details className="fade-up fade-up-7 group mt-3 w-full rounded-[14px] border border-white/40 bg-white/40 p-4 text-left backdrop-blur-sm transition-colors duration-200 open:bg-white/60 sm:p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-medium tracking-[-0.01em] text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
                <span>How it works</span>
                <ChevronDown
                  size={14}
                  className="text-[var(--color-text-muted)] transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <ul className="mt-3 flex flex-col gap-2 body-small">
                <li>
                  <span className="text-[var(--color-text)]">Text the number above.</span> Codex
                  replies in the same iMessage thread and the conversation appears at{" "}
                  <a
                    href={codexUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    chatgpt.com/codex
                  </a>
                  .
                </li>
                <li>
                  Send <span className="kbd">/new</span> to start a fresh task. Previous turns are
                  forgotten in iMessage; the old task stays archived on the web.
                </li>
                <li>
                  Photos work — attach an image in iMessage and Codex sees it. PNG/JPEG/GIF/WEBP
                  under 20 MB.
                </li>
              </ul>
            </details>

            {!t.codexEnvironmentId && (
              <div className="fade-up fade-up-7 mt-3 w-full rounded-[14px] border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_10%,white)] p-4 text-left">
                <p className="text-[13px] leading-snug text-[var(--color-text-muted)]">
                  <span className="font-medium text-[var(--color-text)]">Connect a repo.</span>{" "}
                  Codex needs at least one GitHub repo &mdash;{" "}
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

            <details className="fade-up fade-up-7 group mt-3 w-full rounded-[14px] border border-white/40 bg-white/40 p-4 text-left backdrop-blur-sm transition-colors duration-200 open:bg-white/60 sm:p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-medium tracking-[-0.01em] text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
                <span className="truncate">
                  <span className="text-[var(--color-text-muted)]">ChatGPT</span>{" "}
                  <span className="font-mono">{t.codexUserEmail ?? "linked"}</span>
                </span>
                <ChevronDown
                  size={14}
                  className="ml-2 flex-shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 body-small text-[var(--color-text-dim)]">
                Tokens are stored AES-256-GCM encrypted and refreshed automatically.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={codexUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-pill-secondary inline-flex items-center gap-1.5"
                >
                  <ExternalLink size={13} /> Open chatgpt.com/codex
                </a>
                <button
                  type="button"
                  onClick={reLinkCodex}
                  disabled={reLinking}
                  className="btn-pill-secondary inline-flex items-center gap-1.5"
                >
                  <RotateCcw size={13} /> {reLinking ? "Starting…" : "Re-link"}
                </button>
              </div>
            </details>

            <details className="fade-up fade-up-7 group mt-3 w-full rounded-[14px] border border-white/40 bg-white/40 p-4 text-left backdrop-blur-sm transition-colors duration-200 open:bg-white/60 sm:p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-medium tracking-[-0.01em] text-[var(--color-text-muted)] [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                  <Trash2 size={14} /> Danger zone
                </span>
                <ChevronDown
                  size={14}
                  className="transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 body-small text-[var(--color-text-dim)]">
                Disconnect removes your ChatGPT link, your iMessage thread mappings, and your tenant
                record from this dashboard. The phone number{" "}
                <span className="font-mono text-[var(--color-text)]">{t.phoneNumber}</span> stays
                reserved on your Spectrum project, so re-onboarding gives it back to you.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!confirmDisconnect ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDisconnect(true)}
                    className="btn-pill-secondary inline-flex items-center gap-1.5 text-[var(--color-danger,#c14242)]"
                  >
                    <Trash2 size={13} /> Disconnect account
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={disconnect}
                      disabled={disconnecting}
                      className="btn-pill-primary inline-flex items-center gap-1.5"
                      style={{
                        backgroundColor: "var(--color-danger, #c14242)",
                        borderColor: "var(--color-danger, #c14242)",
                      }}
                    >
                      {disconnecting ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      {disconnecting ? "Disconnecting…" : "Yes, disconnect"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(false)}
                      disabled={disconnecting}
                      className="btn-pill-secondary inline-flex items-center"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </details>
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
      className="fade-up fade-up-5 group relative mt-2 inline-flex items-center gap-2 rounded-xl px-3 py-1.5 outline-none transition-colors duration-150 hover:bg-white/45 focus-visible:ring-2 focus-visible:ring-[rgba(0,0,0,0.18)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      aria-label="Copy phone number"
    >
      <span className="font-mono text-[clamp(28px,3.6vw,40px)] font-medium tracking-[-0.01em] text-[var(--color-text)]">
        {number}
      </span>
      <span
        className={`text-[var(--color-text-muted)] transition-opacity ${copied ? "opacity-100" : "opacity-60 group-hover:opacity-100"}`}
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
