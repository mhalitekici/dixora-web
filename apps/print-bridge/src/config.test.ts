import assert from "node:assert/strict";
import test from "node:test";

import { loadBridgeConfig } from "./config.js";

const baseEnvironment = {
  PRINT_BRIDGE_API_KEY: "test-key",
  PRINT_BRIDGE_BRANCH_ID: "branch-1",
  PRINT_BRIDGE_PRINTER_IDS: "kitchen,bar,kitchen",
};

test("loads and normalizes bridge configuration", () => {
  const config = loadBridgeConfig(baseEnvironment);

  assert.equal(config.apiUrl, "http://localhost:8000");
  assert.deepEqual(config.printerIds, ["KITCHEN", "BAR"]);
  assert.equal(config.mockFailureRate, 0);
});

test("requires credentials unless explicitly running an insecure mock", () => {
  assert.throws(
    () =>
      loadBridgeConfig({
        PRINT_BRIDGE_BRANCH_ID: "branch-1",
        PRINT_BRIDGE_PRINTER_IDS: "kitchen",
      }),
    /PRINT_BRIDGE_TOKEN/,
  );

  const config = loadBridgeConfig({
    PRINT_BRIDGE_ALLOW_INSECURE_MOCK: "true",
    PRINT_BRIDGE_BRANCH_ID: "branch-1",
    PRINT_BRIDGE_PRINTER_IDS: "kitchen",
  });
  assert.equal(config.allowInsecureMock, true);
});

test("accepts a scoped bridge token without a caller-supplied branch", () => {
  const config = loadBridgeConfig({
    PRINT_BRIDGE_TOKEN: "pb_scoped-token",
    PRINT_BRIDGE_PRINTER_IDS: "kitchen",
  });

  assert.equal(config.apiToken, "pb_scoped-token");
  assert.equal(config.branchId, undefined);
});
