import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { PrintJobClaim, PrintResult } from "@dixora/shared-types";

import type { PrintBridgeApiClient } from "./api-client.js";
import { PrintBridge } from "./bridge.js";
import { PrintJournal } from "./journal.js";
import type { PrinterDiscovery, PrinterTransport } from "./printer-transport.js";
import { BridgeState } from "./state.js";
import { testConfig } from "./test-helpers.js";

function job(overrides: Partial<PrintJobClaim> = {}): PrintJobClaim {
  return {
    id: "job-1",
    tenantId: "tenant-1",
    branchId: "branch-1",
    printerDeviceId: "MUTFAK",
    preparationStationId: "station-1",
    orderId: "order-1",
    kitchenTicketId: "ticket-1",
    contentType: "application/vnd.dixora.receipt+json",
    copies: 1,
    isReprint: false,
    attemptCount: 1,
    claimedAt: "2026-09-06T19:42:00Z",
    document: {
      title: "MUTFAK",
      branchName: "Aleyin Mutfağı",
      stationName: "Mutfak",
      orderNumber: "A1042",
      submittedAt: "2026-09-06T19:42:00Z",
      lines: [{ name: "Adana Kebap", quantity: "1" }],
    },
    ...overrides,
  };
}

const result: PrintResult = {
  externalReference: "bridge-1:MUTFAK:job-1:1",
  printedAt: "2026-09-06T19:42:02Z",
  transport: "mock",
};

async function journalPath(context: { after: (fn: () => unknown) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dixora-bridge-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "journal.json");
}

function api(overrides: Record<string, unknown>): PrintBridgeApiClient {
  return overrides as unknown as PrintBridgeApiClient;
}

function printer(onPrint: () => Promise<PrintResult>): PrinterTransport {
  return { print: onPrint };
}

test("does not reprint an acknowledged-pending ticket after the server issues a newer lease", async (context) => {
  const path = await journalPath(context);
  const journal = new PrintJournal(path);
  await journal.load();
  await journal.recordPrinted(job(), result);

  let physicalPrints = 0;
  const printedAttempts: number[] = [];
  const bridge = new PrintBridge(
    testConfig({ journalPath: path }),
    api({
      claimJobs: async () => [job({ attemptCount: 2 })],
      markPrinted: async (claimed: PrintJobClaim) => {
        printedAttempts.push(claimed.attemptCount);
      },
    }),
    printer(async () => {
      physicalPrints += 1;
      return result;
    }),
    new BridgeState("bridge-1"),
    journal,
  );

  await bridge.poll();

  assert.equal(physicalPrints, 0);
  assert.deepEqual(printedAttempts, [2]);
  assert.equal(journal.get("job-1")?.acknowledged, true);
});

test("restart recovery marks an uncertain dispatch for manual retry without printing", async (context) => {
  const path = await journalPath(context);
  const firstJournal = new PrintJournal(path);
  await firstJournal.load();
  await firstJournal.recordDispatching(job());

  const restartedJournal = new PrintJournal(path);
  const uncertainAttempts: number[] = [];
  let physicalPrints = 0;
  const bridge = new PrintBridge(
    testConfig({ journalPath: path }),
    api({
      recoverUncertainDispatch: async (_jobId: string, attemptCount: number) => {
        uncertainAttempts.push(attemptCount);
      },
    }),
    printer(async () => {
      physicalPrints += 1;
      return result;
    }),
    new BridgeState("bridge-1"),
    restartedJournal,
  );
  const controller = new AbortController();
  controller.abort();

  await bridge.run(controller.signal);

  assert.equal(physicalPrints, 0);
  assert.deepEqual(uncertainAttempts, [1]);
  assert.equal(restartedJournal.get("job-1")?.acknowledged, true);
});

test("keeps sending a heartbeat when local printer discovery has a temporary error", async (context) => {
  const path = await journalPath(context);
  const inventories: string[][] = [];
  let discoveryCalls = 0;
  const discovery: PrinterDiscovery = {
    listPrinters: async () => {
      discoveryCalls += 1;
      if (discoveryCalls === 1) return ["MUTFAK"];
      throw new Error("Get-Printer is temporarily unavailable");
    },
  };
  const bridge = new PrintBridge(
    testConfig({ journalPath: path }),
    api({
      heartbeat: async (printers: readonly string[]) => {
        inventories.push([...printers]);
      },
    }),
    printer(async () => result),
    new BridgeState("bridge-1"),
    new PrintJournal(path),
    discovery,
  );

  const privateBridge = bridge as unknown as {
    heartbeatIfDue: () => Promise<void>;
    lastHeartbeatAt: number;
  };
  await privateBridge.heartbeatIfDue();
  privateBridge.lastHeartbeatAt = 0;
  await privateBridge.heartbeatIfDue();

  assert.deepEqual(inventories, [["MUTFAK"], ["MUTFAK"]]);
});
