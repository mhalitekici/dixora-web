#!/usr/bin/env node

import {
  bridgePlatformLabel,
  discoverSystemPrinters,
  startBridgeRuntime,
} from "./agent-runtime.js";
import { loadBridgeConfig } from "./config.js";
import { runEnroll } from "./enroll.js";
import { log } from "./logger.js";
import { safeErrorMessage } from "./protocol.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "run";
  if (command === "enroll") {
    await enroll();
    return;
  }
  if (command === "printers") {
    await listPrinters();
    return;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }
  if (command !== "run") {
    throw new Error(
      `Unknown command '${command}'. Run 'dixora-print-bridge --help'.`,
    );
  }

  const runtime = await startBridgeRuntime();

  const stop = (signal: NodeJS.Signals) => {
    log("info", "shutdown_requested", { signal });
    runtime.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await runtime.completed;
}

async function enroll(): Promise<void> {
  const config = loadBridgeConfig(process.env, {
    requireCredentials: false,
    requirePrinterIds: false,
  });
  const code = readOption("--code");
  const name = readOption("--name");
  if (!code || !name) {
    throw new Error(
      'Enrollment needs --code XXXX-XXXX and --name "Bilgisayar adı".',
    );
  }
  const credential = await runEnroll({
    apiUrl: config.apiUrl,
    code,
    name,
    platform: bridgePlatformLabel(),
    version: config.version,
    credentialsPath: config.credentialsPath,
  });
  log("info", "bridge_enrolled", {
    bridgeId: credential.bridgeId,
    branchId: credential.branchId,
    name: credential.name,
  });
}

async function listPrinters(): Promise<void> {
  for (const printer of await discoverSystemPrinters()) {
    process.stdout.write(`${printer}\n`);
  }
}

function readOption(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : null;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Dixora Print Bridge",
      '  dixora-print-bridge enroll --code A7K9-4P2M --name "Kasa Bilgisayarı"',
      "  dixora-print-bridge printers",
      "  dixora-print-bridge run",
    ].join("\n") + "\n",
  );
}

main().catch((error: unknown) => {
  log("error", "bridge_crashed", { message: safeErrorMessage(error) });
  process.exitCode = 1;
});
