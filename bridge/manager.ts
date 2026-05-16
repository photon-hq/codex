import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { type TenantHealth, TenantWorker } from "./tenant";

const POLL_INTERVAL_MS = Number(process.env.BRIDGE_POLL_INTERVAL_MS ?? 10_000);

export interface BridgeStatus {
  lastSyncAt: number | null;
  lastSyncError: string | null;
  running: boolean;
  startedAt: number | null;
  tenantCount: number;
  tenants: TenantHealth[];
}

export class BridgeManager {
  private workers = new Map<string, TenantWorker>();
  private interval: NodeJS.Timeout | null = null;
  private startedAt: number | null = null;
  private lastSyncAt: number | null = null;
  private lastSyncError: string | null = null;
  private startPromise: Promise<void> | null = null;

  isRunning() {
    return this.startedAt !== null;
  }

  start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.bootstrap().catch((err) => {
      this.startPromise = null;
      throw err;
    });
    return this.startPromise;
  }

  private async bootstrap() {
    if (this.startedAt) {
      return;
    }
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    if (!process.env.MASTER_KEY) {
      throw new Error("MASTER_KEY is not set");
    }
    if (!process.env.SPECTRUM_API_HOST) {
      throw new Error("SPECTRUM_API_HOST is not set");
    }

    console.log("[bridge] starting…");
    await this.sync();
    this.startedAt = Date.now();
    console.log(`[bridge] up with ${this.workers.size} tenants`);

    this.interval = setInterval(() => {
      this.sync().catch((err) => {
        this.lastSyncError = err instanceof Error ? err.message : String(err);
        console.error("[bridge] sync error:", err);
      });
    }, POLL_INTERVAL_MS);
    this.interval.unref?.();
  }

  async sync() {
    const db = getDb();
    const rows = await db.select().from(tenants);
    const seenIds = new Set<string>();
    for (const row of rows) {
      seenIds.add(row.id);
      const existing = this.workers.get(row.id);
      if (existing) {
        existing.refresh(row);
        continue;
      }
      const worker = new TenantWorker(row);
      this.workers.set(row.id, worker);
      await worker.start();
      console.log(`[bridge] +tenant ${row.id} (${row.phoneNumber})`);
    }
    for (const [id, worker] of this.workers) {
      if (!seenIds.has(id)) {
        await worker.stop();
        this.workers.delete(id);
        console.log(`[bridge] -tenant ${id}`);
      }
    }
    this.lastSyncAt = Date.now();
    this.lastSyncError = null;
  }

  authDeadTenants(): string[] {
    return Array.from(this.workers.values())
      .filter((w) => w.isAuthDead)
      .map((w) => w.id);
  }

  async stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    await Promise.all(Array.from(this.workers.values()).map((w) => w.stop()));
    this.workers.clear();
    this.startedAt = null;
    this.startPromise = null;
  }

  status(): BridgeStatus {
    return {
      running: this.startedAt !== null,
      startedAt: this.startedAt,
      tenantCount: this.workers.size,
      lastSyncAt: this.lastSyncAt,
      lastSyncError: this.lastSyncError,
      tenants: Array.from(this.workers.values(), (w) => w.health()),
    };
  }

  findByTenantId(tenantId: string): TenantHealth | null {
    return this.workers.get(tenantId)?.health() ?? null;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __codexBridge?: BridgeManager;
};

export function getBridgeManager(): BridgeManager {
  if (!globalStore.__codexBridge) {
    globalStore.__codexBridge = new BridgeManager();
  }
  return globalStore.__codexBridge;
}
