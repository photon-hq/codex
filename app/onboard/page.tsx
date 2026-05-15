import { BackHomePill, PageShell, TopNav } from "@/components/chrome";
import { Suspense } from "react";
import OnboardClient from "./onboard-client";

export default function OnboardPage() {
  return (
    <>
      <TopNav left={<BackHomePill />} />
      <PageShell contentClassName="justify-center">
        <Suspense
          fallback={
            <div className="flex w-full max-w-[480px] flex-col items-center text-center">
              <div className="skeleton-chip" aria-hidden />
              <div className="mt-6 flex items-center gap-1.5" aria-hidden>
                {["a", "b", "c", "d"].map((id) => (
                  <span key={id} className="skeleton-dot" />
                ))}
              </div>
              <div className="skeleton-line mt-5 w-[60%]" aria-hidden />
              <div className="skeleton-line mt-3 w-[80%]" aria-hidden />
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
