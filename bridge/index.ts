import { getBridgeManager } from "./manager";

async function main() {
  const manager = getBridgeManager();
  try {
    await manager.start();
  } catch (err) {
    console.error("[bridge] failed to start:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    console.log(`[bridge] received ${signal}, stopping workers…`);
    await manager.stop();
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
