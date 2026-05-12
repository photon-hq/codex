import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { TenantWorker } from "./tenant";

const POLL_INTERVAL_MS = Number(process.env.BRIDGE_POLL_INTERVAL_MS ?? 10_000);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  if (!process.env.MASTER_KEY) {
    console.error("MASTER_KEY is not set");
    process.exit(1);
  }
  if (!process.env.SPECTRUM_API_HOST || !process.env.SPECTRUM_RUNTIME_HOST) {
    console.error("SPECTRUM_API_HOST and SPECTRUM_RUNTIME_HOST must be set");
    process.exit(1);
  }

  console.log("[bridge] starting…");
  const workers = new Map<string, TenantWorker>();
  const db = getDb();

  async function sync() {
    const rows = await db.select().from(tenants);
    const seenIds = new Set<string>();
    for (const row of rows) {
      seenIds.add(row.id);
      const existing = workers.get(row.id);
      if (existing) {
        existing.refresh(row);
        continue;
      }
      const worker = new TenantWorker(row);
      workers.set(row.id, worker);
      await worker.start();
      console.log(`[bridge] +tenant ${row.id} (${row.phoneNumber})`);
    }
    for (const [id, worker] of workers) {
      if (!seenIds.has(id)) {
        await worker.stop();
        workers.delete(id);
        console.log(`[bridge] -tenant ${id}`);
      }
    }
  }

  await sync();
  console.log(`[bridge] up with ${workers.size} tenants`);

  const interval = setInterval(() => {
    sync().catch((err) => console.error("[bridge] sync error:", err));
  }, POLL_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    console.log(`[bridge] received ${signal}, stopping workers…`);
    clearInterval(interval);
    await Promise.all(Array.from(workers.values()).map((w) => w.stop()));
    console.log("[bridge] bye.");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[bridge] fatal:", err);
  process.exit(1);
});
