import type { Server } from "node:http";

import { PrintBridgeApiClient } from "./api-client.js";
import {
  applyCredential,
  loadBridgeConfig,
  type BridgeConfig,
} from "./config.js";
import { loadCredential } from "./credentials.js";
import { startHealthServer, stopHealthServer } from "./health-server.js";
import { PrintJournal } from "./journal.js";
import { MacPrinterDiscovery, MacPrinterTransport } from "./macos-printer.js";
import { MockPrinterTransport } from "./mock-printer.js";
import {
  type PrinterDiscovery,
  type PrinterTransport,
} from "./printer-transport.js";
import { PrintBridge } from "./bridge.js";
import { BridgeState } from "./state.js";
import {
  WindowsPrinterDiscovery,
  WindowsPrinterTransport,
} from "./windows-printer.js";

export interface BridgeRuntime {
  completed: Promise<void>;
  config: BridgeConfig;
  state: BridgeState;
  stop(): void;
}

/**
 * Starts the reusable print loop without deciding how the host application's
 * lifecycle works. The CLI, the Windows desktop app and a future macOS app
 * can therefore share the exact same local-journal and physical-print path.
 */
export async function startBridgeRuntime(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<BridgeRuntime> {
  const baseConfig = loadBridgeConfig(environment, {
    requireCredentials: false,
    requirePrinterIds: false,
  });
  const config = applyCredential(
    baseConfig,
    await loadCredential(baseConfig.credentialsPath),
  );
  if (!config.apiToken && !config.apiKey && !config.allowInsecureMock) {
    throw new Error(
      "Bu Print Bridge henüz bağlanmadı. Uygulamadaki bağlantı kodunu girin.",
    );
  }

  const { discovery, printer } = createTransport(config);
  const state = new BridgeState(config.bridgeId);
  const bridge = new PrintBridge(
    config,
    new PrintBridgeApiClient(config),
    printer,
    state,
    new PrintJournal(config.journalPath),
    discovery,
  );
  const healthServer =
    config.healthPort > 0 ? startHealthServer(config.healthPort, state) : null;
  const abortController = new AbortController();
  const completed = bridge
    .run(abortController.signal)
    .finally(() => stopDiagnosticsServer(healthServer));

  return {
    completed,
    config,
    state,
    stop: () => abortController.abort(),
  };
}

export async function discoverSystemPrinters(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string[]> {
  const config = loadBridgeConfig(environment, {
    requireCredentials: false,
    requirePrinterIds: false,
  });
  const { discovery } = createTransport(config);
  if (!discovery) {
    throw new Error(
      "Mock taşıması işletim sistemindeki yazıcıları keşfedemez.",
    );
  }
  return discovery.listPrinters();
}

export function createTransport(config: BridgeConfig): {
  printer: PrinterTransport;
  discovery?: PrinterDiscovery;
} {
  const transport =
    config.transport === "auto" ? platformTransport() : config.transport;
  if (transport === "windows") {
    return {
      printer: new WindowsPrinterTransport(config),
      discovery: new WindowsPrinterDiscovery(),
    };
  }
  if (transport === "macos") {
    return {
      printer: new MacPrinterTransport(config),
      discovery: new MacPrinterDiscovery(),
    };
  }
  if (transport === "mock") {
    if (
      process.env.NODE_ENV !== "development" &&
      process.env.NODE_ENV !== "test"
    ) {
      throw new Error("Mock taşıması yalnız geliştirme veya testte kullanılabilir.");
    }
    return { printer: new MockPrinterTransport(config) };
  }
  throw new Error(`Desteklenmeyen yazdırma taşıması: ${transport}.`);
}

export function bridgePlatformLabel(): "windows" | "macos" | "linux" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function platformTransport(): "windows" | "macos" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  throw new Error(
    "Bu işletim sisteminde fiziksel yazdırma taşıması yok. Mock yalnız geliştirme/test ortamında kullanılabilir.",
  );
}

async function stopDiagnosticsServer(server: Server | null): Promise<void> {
  if (server) await stopHealthServer(server);
}
