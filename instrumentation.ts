export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.BRIDGE_EMBED === "0") return;
  const { getBridgeManager } = await import("./bridge/manager");
  const manager = getBridgeManager();
  if (manager.isRunning()) return;
  try {
    await manager.start();
    console.log("[instrumentation] embedded bridge started");
  } catch (err) {
    console.error("[instrumentation] failed to start embedded bridge:", err);
  }
}
