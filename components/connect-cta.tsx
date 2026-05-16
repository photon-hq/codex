"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const LABEL = "Get started";

export function ConnectCta() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tenant/me", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          provisioned?: boolean;
          tenant?: { codexLinked?: boolean };
        };
        if (data.provisioned && data.tenant?.codexLinked) {
          router.push("/dashboard");
          return;
        }
      }
      router.push("/onboard");
    } catch {
      router.push("/onboard");
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="btn-pill-primary inline-flex items-center justify-center disabled:cursor-progress"
    >
      {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
      {LABEL}
      {!busy && <ArrowRight size={14} className="ml-1.5" />}
    </button>
  );
}
