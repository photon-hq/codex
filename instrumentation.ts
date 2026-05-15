export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // spectrum-ts reads SPECTRUM_CLOUD_URL as a bare hostname. Derive it from
  // SPECTRUM_RUNTIME_HOST (or the dashboard host) so a single env var keeps
  // both REST calls and the SDK pointed at the same cloud.
  const dash = process.env.SPECTRUM_API_HOST ?? "";
  const isStaging = /staging-app\.photon\.codes/.test(dash);

  if (!process.env.SPECTRUM_CLOUD_URL) {
    const runtime = process.env.SPECTRUM_RUNTIME_HOST;
    if (runtime) {
      process.env.SPECTRUM_CLOUD_URL = runtime.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    } else if (isStaging) {
      process.env.SPECTRUM_CLOUD_URL = "staging-spectrum-cloud.photon.codes";
    }
  }

  if (!process.env.SPECTRUM_IMESSAGE_ADDRESS && isStaging) {
    process.env.SPECTRUM_IMESSAGE_ADDRESS = "staging-spectrum-imessage.photon.codes:443";
  }

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
