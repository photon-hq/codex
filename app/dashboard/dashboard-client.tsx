"use client";

import { BackHomePill, CodexIcon, TopNav } from "@/components/chrome";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  LogOut,
  MessageSquare,
  RotateCcw,
  Sparkles,
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

  if (loading) {
    return <div className="body-small text-[var(--color-text-muted)]">Loading…</div>;
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
        <div className="flex w-full flex-1 flex-col items-center px-5 pb-16 pt-6 sm:px-8 sm:pb-20 sm:pt-10">
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
              {t.redirectUri && (
                <a
                  href={t.redirectUri}
                  className="btn-pill-primary inline-flex items-center gap-1.5"
                >
                  <MessageSquare size={14} /> Open in iMessage
                </a>
              )}
              <a
                href={`sms:${t.phoneNumber}`}
                className="text-[12.5px] tracking-[-0.005em] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]"
              >
                or open as sms://
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

            <details
              open
              className="fade-up fade-up-7 group mt-3 w-full rounded-[14px] border border-white/40 bg-white/40 p-4 text-left backdrop-blur-sm transition-colors duration-200 open:bg-white/60 sm:p-5"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-medium tracking-[-0.01em] text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                  <Sparkles size={14} /> ChatGPT account
                </span>
                <ChevronDown
                  size={14}
                  className="text-[var(--color-text-muted)] transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 body-small text-[var(--color-text-dim)]">
                Signed in as{" "}
                <span className="font-mono text-[var(--color-text)]">
                  {t.codexUserEmail ?? "your ChatGPT account"}
                </span>
                . Tokens are stored AES-256-GCM encrypted and refreshed automatically.
              </p>
              {!t.codexEnvironmentId && (
                <p className="mt-3 body-small text-[var(--color-warning,var(--color-text-dim))]">
                  No Codex Cloud environment connected. Codex needs at least one GitHub repo —{" "}
                  <a
                    href="https://chatgpt.com/codex/settings/environments"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    add one in chatgpt.com/codex
                  </a>{" "}
                  before texting.
                </p>
              )}
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
                  <RotateCcw size={13} /> {reLinking ? "Starting…" : "Re-link ChatGPT"}
                </button>
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
