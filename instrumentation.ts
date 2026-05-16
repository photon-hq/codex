export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // spectrum-ts reads SPECTRUM_CLOUD_URL as a bare hostname. Derive it from
  // SPECTRUM_RUNTIME_HOST when set so a single env var keeps both REST calls
  // and the SDK pointed at the same cloud.
  if (!process.env.SPECTRUM_CLOUD_URL && process.env.SPECTRUM_RUNTIME_HOST) {
    process.env.SPECTRUM_CLOUD_URL = process.env.SPECTRUM_RUNTIME_HOST.replace(
      /^https?:\/\//,
      ""
    ).replace(/\/+$/, "");
  }

  if (process.env.BRIDGE_EMBED === "0") {
    return;
  }
  const { getBridgeManager } = await import("./bridge/manager");
  const manager = getBridgeManager();
  if (manager.isRunning()) {
    return;
  }
  try {
    await manager.start();
    console.log("[instrumentation] embedded bridge started");
  } catch (err) {
    console.error("[instrumentation] failed to start embedded bridge:", err);
  }
}
