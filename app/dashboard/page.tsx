import { Suspense } from "react";
import DashboardClient from "./dashboard-client";

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="relative flex flex-1 items-center justify-center">
          <div className="body-small text-[var(--color-text-muted)]">Loading…</div>
        </main>
      }
    >
      <DashboardClient />
    </Suspense>
  );
}
