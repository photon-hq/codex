"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Status = "loading" | "fresh" | "needs-codex" | "live";

export function ConnectCta() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tenant/me")
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 401) {
          setStatus("fresh");
          return;
        }
        const data = (await r.json().catch(() => ({}))) as {
          provisioned?: boolean;
          tenant?: { codexLinked?: boolean };
        };
        if (!data.provisioned) setStatus("fresh");
        else if (data.tenant?.codexLinked) setStatus("live");
        else setStatus("needs-codex");
      })
      .catch(() => {
        if (!cancelled) setStatus("fresh");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <button
        type="button"
        disabled
        className="btn-pill-primary inline-flex items-center justify-center opacity-70"
      >
        <Loader2 size={14} className="mr-1.5 animate-spin" />
        Loading
      </button>
    );
  }

  if (status === "live") {
    return (
      <button
        type="button"
        onClick={() => router.push("/dashboard")}
        className="btn-pill-primary inline-flex items-center justify-center"
      >
        Open dashboard
        <ArrowRight size={14} className="ml-1.5" />
      </button>
    );
  }

  return (
    <Link href="/onboard" className="btn-pill-primary inline-flex items-center justify-center">
      {status === "needs-codex" ? "Finish ChatGPT login" : "Connect to iMessage"}
      <ArrowRight size={14} className="ml-1.5" />
    </Link>
  );
}
