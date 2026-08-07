import {
  readBoolean,
  readCsv,
  readEnvironmentValue,
  readFloat,
  readInteger,
} from "@dixora/config";

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
}

export function loadBridgeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): BridgeConfig {
  const allowInsecureMock = readBoolean(
    environment,
    "PRINT_BRIDGE_ALLOW_INSECURE_MOCK",
    false,
  );
  const apiKey = readEnvironmentValue(environment, "PRINT_BRIDGE_API_KEY", "");
  const apiToken = readEnvironmentValue(environment, "PRINT_BRIDGE_TOKEN", "");

  if (!apiToken && !apiKey && !allowInsecureMock) {
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
  if (printerIds.length === 0) {
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
    healthPort: readInteger(environment, "PRINT_BRIDGE_PORT", 9100, {
      min: 1,
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
  };
}
