import type { BridgeConfig } from "./config.js";

/** A complete, valid `BridgeConfig` for tests to spread and override. */
export function testConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    apiKey: "test",
    apiUrl: "http://api.test",
    allowInsecureMock: false,
    branchId: "branch-1",
    bridgeId: "bridge-1",
    healthPort: 9100,
    maxClaim: 5,
    mockDelayMs: 0,
    mockFailureRate: 0,
    pollIntervalMs: 2_000,
    printerIds: ["kitchen"],
    requestTimeoutMs: 5_000,
    version: "test",
    transport: "mock",
    printerNameMap: {},
    heartbeatIntervalMs: 20_000,
    credentialsPath: "/tmp/dixora-print-bridge-test/credentials.json",
    journalPath: "/tmp/dixora-print-bridge-test/journal.json",
    ...overrides,
  };
}
