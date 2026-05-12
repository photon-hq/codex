import { BackHomePill, PageShell, TopNav } from "@/components/chrome";
import { Suspense } from "react";
import OnboardClient from "./onboard-client";

export default function OnboardPage() {
  return (
    <>
      <TopNav left={<BackHomePill />} />
      <PageShell contentClassName="justify-center">
        <Suspense
          fallback={<div className="body-small text-[var(--color-text-muted)]">Loading…</div>}
        >
          <OnboardClient />
        </Suspense>
      </PageShell>
    </>
  );
}
