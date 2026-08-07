import assert from "node:assert/strict";
import test from "node:test";

import type { PrintJobClaim } from "@dixora/shared-types";

import type { BridgeConfig } from "./config.js";
import { MockPrinterTransport } from "./mock-printer.js";

const config: BridgeConfig = {
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
};

const job: PrintJobClaim = {
  id: "job-1",
  tenantId: "tenant-1",
  branchId: "branch-1",
  printerDeviceId: "kitchen",
  preparationStationId: "station-1",
  orderId: "order-1",
  kitchenTicketId: "ticket-1",
  contentType: "application/vnd.dixora.receipt+json",
  document: {
    title: "Kitchen",
    branchName: "Dixora Lab Main Branch",
    stationName: "Kitchen",
    orderNumber: "A-100",
    submittedAt: "2026-07-30T20:00:00.000Z",
    lines: [{ name: "Burger", quantity: "1" }],
  },
  copies: 1,
  isReprint: false,
  attemptCount: 1,
  claimedAt: "2026-07-30T20:00:00.000Z",
};

test("mock printer returns a deterministic receipt reference", async () => {
  const transport = new MockPrinterTransport(config, {
    delay: async () => undefined,
    random: () => 0.5,
  });

  const result = await transport.print(job);
  assert.equal(result.externalReference, "bridge-1:kitchen:job-1:1");
  assert.equal(result.transport, "mock");
});

test("mock printer rejects jobs for an unconfigured printer", async () => {
  const transport = new MockPrinterTransport(config, {
    delay: async () => undefined,
  });

  await assert.rejects(
    transport.print({ ...job, printerDeviceId: "unknown" }),
    /not configured/,
  );
});
