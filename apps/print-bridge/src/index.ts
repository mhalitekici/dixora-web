import { PrintBridgeApiClient } from "./api-client.js";
import { PrintBridge } from "./bridge.js";
import { loadBridgeConfig } from "./config.js";
import { startHealthServer, stopHealthServer } from "./health-server.js";
import { log } from "./logger.js";
import { MockPrinterTransport } from "./mock-printer.js";
import { safeErrorMessage } from "./protocol.js";
import { BridgeState } from "./state.js";

async function main(): Promise<void> {
  const config = loadBridgeConfig();
  const state = new BridgeState(config.bridgeId);
  const api = new PrintBridgeApiClient(config);
  const printer = new MockPrinterTransport(config);
  const bridge = new PrintBridge(config, api, printer, state);
  const healthServer = startHealthServer(config.healthPort, state);
  const abortController = new AbortController();

  const stop = (signal: NodeJS.Signals) => {
    log("info", "shutdown_requested", { signal });
    abortController.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await bridge.run(abortController.signal);
  } finally {
    await stopHealthServer(healthServer);
  }
}

main().catch((error: unknown) => {
  log("error", "bridge_crashed", { message: safeErrorMessage(error) });
  process.exitCode = 1;
});
