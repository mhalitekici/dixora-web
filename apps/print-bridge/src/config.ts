import { homedir } from "node:os";
import { join } from "node:path";

import {
  readBoolean,
  readCsv,
  readEnvironmentValue,
  readFloat,
  readInteger,
} from "@dixora/config";

import type { BridgeCredential } from "./credentials.js";

export type PrinterTransportSetting = "auto" | "mock" | "windows" | "macos";

export interface BridgeConfig {
  apiKey: string;
  apiToken?: string;
  apiUrl: string;
  allowInsecureMock: boolean;
  branchId?: string;
  bridgeId: string;
  healthPort: number;
  maxClaim: number;
  mockDelayMs: number;
  mockFailureRate: number;
  pollIntervalMs: number;
  printerIds: readonly string[];
  requestTimeoutMs: number;
  version: string;
  /** Which OS printing mechanism to use. "auto" picks from `process.platform`. */
  transport: PrinterTransportSetting;
  /** Dixora printer code -> exact local OS printer name, when they differ. A
   * code with no entry here is looked up under its own name (the common case
   * from the task: `MUTFAK` the Dixora code *is* `MUTFAK` the OS printer). */
  printerNameMap: Readonly<Record<string, string>>;
  /** How often the bridge reports liveness even when the job queue is empty —
   * without this, an idle branch looks identical to a crashed one. */
  heartbeatIntervalMs: number;
  /** Where an enrolled bridge's credential (tenant/branch/bridge id/token) is
   * kept between runs. Never committed, never logged. */
  credentialsPath: string;
  /** Durable record of every job this bridge has physically printed, kept
   * across restarts so a reclaimed job is never printed a second time. */
  journalPath: string;
}

export interface LoadBridgeConfigOptions {
  /** Enrollment runs before a credential exists; normal bridge startup does
   * not. Keeping this explicit prevents a production agent from accidentally
   * polling anonymously. */
  requireCredentials?: boolean;
  /** Scoped agents receive authorized printer mappings from the cloud, so they
   * need not carry a second, static printer-code allow-list in their env. */
  requirePrinterIds?: boolean;
}

const DEFAULT_STATE_DIR = join(homedir(), ".dixora-print-bridge");

function parsePrinterNameMap(value: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const code = trimmed.slice(0, separatorIndex).trim().toUpperCase();
    const localName = trimmed.slice(separatorIndex + 1).trim();
    if (code && localName) {
      map[code] = localName;
    }
  }
  return map;
}

export function loadBridgeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: LoadBridgeConfigOptions = {},
): BridgeConfig {
  const requireCredentials = options.requireCredentials ?? true;
  const requirePrinterIds = options.requirePrinterIds ?? true;
  const allowInsecureMock = readBoolean(
    environment,
    "PRINT_BRIDGE_ALLOW_INSECURE_MOCK",
    false,
  );
  const apiKey = readEnvironmentValue(environment, "PRINT_BRIDGE_API_KEY", "");
  const apiToken = readEnvironmentValue(environment, "PRINT_BRIDGE_TOKEN", "");

  if (requireCredentials && !apiToken && !apiKey && !allowInsecureMock) {
    throw new Error(
      "PRINT_BRIDGE_TOKEN (or the development-only PRINT_BRIDGE_API_KEY) is required unless PRINT_BRIDGE_ALLOW_INSECURE_MOCK=true",
    );
  }
  const branchId = readEnvironmentValue(
    environment,
    "PRINT_BRIDGE_BRANCH_ID",
    "",
  );
  if (!apiToken && apiKey && !branchId) {
    throw new Error(
      "PRINT_BRIDGE_BRANCH_ID is required when using the legacy development API key",
    );
  }

  const printerIds = readCsv(environment, "PRINT_BRIDGE_PRINTER_IDS").map(
    (printerId) => printerId.toUpperCase(),
  );
  if (requirePrinterIds && printerIds.length === 0) {
    throw new Error(
      "PRINT_BRIDGE_PRINTER_IDS must contain at least one printer",
    );
  }

  return {
    apiKey,
    ...(apiToken ? { apiToken } : {}),
    apiUrl: readEnvironmentValue(
      environment,
      "PRINT_BRIDGE_API_URL",
      "http://localhost:8000",
    ).replace(/\/+$/, ""),
    allowInsecureMock,
    ...(branchId ? { branchId } : {}),
    bridgeId: readEnvironmentValue(
      environment,
      "PRINT_BRIDGE_ID",
      "local-mock-bridge",
    ),
    // Production agents do not need an inbound port. A local-only diagnostics
    // server can be explicitly enabled for support or development.
    healthPort: readInteger(environment, "PRINT_BRIDGE_PORT", 0, {
      min: 0,
      max: 65_535,
    }),
    maxClaim: readInteger(environment, "PRINT_BRIDGE_MAX_CLAIM", 5, {
      min: 1,
      max: 25,
    }),
    mockDelayMs: readInteger(environment, "PRINT_BRIDGE_MOCK_DELAY_MS", 250, {
      min: 0,
      max: 60_000,
    }),
    mockFailureRate: readFloat(
      environment,
      "PRINT_BRIDGE_MOCK_FAILURE_RATE",
      0,
      { min: 0, max: 1 },
    ),
    pollIntervalMs: readInteger(
      environment,
      "PRINT_BRIDGE_POLL_INTERVAL_MS",
      2_000,
      { min: 250, max: 60_000 },
    ),
    printerIds,
    requestTimeoutMs: readInteger(
      environment,
      "PRINT_BRIDGE_REQUEST_TIMEOUT_MS",
      5_000,
      { min: 250, max: 60_000 },
    ),
    version: readEnvironmentValue(environment, "PRINT_BRIDGE_VERSION", "0.1.0"),
    transport: readTransportSetting(environment),
    printerNameMap: parsePrinterNameMap(
      readEnvironmentValue(environment, "PRINT_BRIDGE_PRINTER_MAP", ""),
    ),
    heartbeatIntervalMs: readInteger(
      environment,
      "PRINT_BRIDGE_HEARTBEAT_INTERVAL_MS",
      20_000,
      { min: 1_000, max: 300_000 },
    ),
    credentialsPath: readEnvironmentValue(
      environment,
      "PRINT_BRIDGE_CREDENTIALS_PATH",
      join(DEFAULT_STATE_DIR, "credentials.json"),
    ),
    journalPath: readEnvironmentValue(
      environment,
      "PRINT_BRIDGE_JOURNAL_PATH",
      join(DEFAULT_STATE_DIR, "journal.json"),
    ),
  };
}

/** Prefer an explicit environment token for managed/test deployments, then
 * fall back to the credential safely saved by the local enrollment command. */
export function applyCredential(
  config: BridgeConfig,
  credential: BridgeCredential | null,
): BridgeConfig {
  if (config.apiToken || config.apiKey || credential === null) {
    return config;
  }
  return {
    ...config,
    apiToken: credential.token,
    bridgeId: credential.bridgeId,
    branchId: credential.branchId,
  };
}

function readTransportSetting(
  environment: Readonly<Record<string, string | undefined>>,
): PrinterTransportSetting {
  const raw = readEnvironmentValue(
    environment,
    "PRINT_BRIDGE_TRANSPORT",
    "auto",
  ).toLowerCase();
  if (raw === "mock" || raw === "windows" || raw === "macos") {
    return raw;
  }
  return "auto";
}
