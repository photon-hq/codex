import { Suspense } from "react";
import { PageShell, TopNav } from "@/components/chrome";
import OnboardClient from "./onboard-client";

export default function OnboardPage() {
  return (
    <>
      <TopNav right={<span />} />
      <PageShell contentClassName="justify-center">
        <Suspense
          fallback={
            <div className="flex w-full max-w-[480px] flex-col items-center text-center">
              <div aria-hidden className="skeleton-chip" />
              <div aria-hidden className="mt-6 flex items-center gap-1.5">
                {["a", "b", "c", "d"].map((id) => (
                  <span className="skeleton-dot" key={id} />
                ))}
              </div>
              <div aria-hidden className="skeleton-line mt-5 w-[60%]" />
              <div aria-hidden className="skeleton-line mt-3 w-[80%]" />
              <div className="sr-only">Loading</div>
            </div>
          }
        >
          <OnboardClient />
        </Suspense>
      </PageShell>
    </>
  );
}
