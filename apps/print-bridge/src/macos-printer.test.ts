import assert from "node:assert/strict";
import test from "node:test";

import type { PrintJobClaim } from "@dixora/shared-types";

import { MacPrinterDiscovery, MacPrinterTransport } from "./macos-printer.js";
import type { ExecFn } from "./process-exec.js";
import { PrinterNotConfiguredError } from "./printer-transport.js";
import { testConfig } from "./test-helpers.js";

function job(overrides: Partial<PrintJobClaim> = {}): PrintJobClaim {
  return {
    id: "job-1",
    tenantId: "tenant-1",
    branchId: "branch-1",
    printerDeviceId: "BAR",
    preparationStationId: "station-1",
    orderId: "order-1",
    kitchenTicketId: "ticket-1",
    contentType: "application/vnd.dixora.receipt+json",
    copies: 1,
    isReprint: false,
    isTestPrint: false,
    attemptCount: 1,
    claimedAt: "2026-09-06T19:42:00Z",
    document: {
      title: "BAR",
      branchName: "Aleyin Mutfağı",
      stationName: "Bar",
      orderNumber: "A1042",
      submittedAt: "2026-09-06T19:42:00Z",
      lines: [{ name: "Coca-Cola", quantity: "2" }],
    },
    ...overrides,
  };
}

function fakeExec(
  calls: Array<{ command: string; args: readonly string[] }>,
): ExecFn {
  return async (command, args) => {
    calls.push({ command, args });
    return { stdout: "request id is BAR-123 (1 file(s))\n", stderr: "" };
  };
}

test("prints through lp with the requested copy count in one call", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const transport = new MacPrinterTransport(
    testConfig({ printerIds: ["BAR"] }),
    fakeExec(calls),
    async () => 9,
  );

  await transport.print(job({ copies: 3 }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.command, "lp");
  assert.deepEqual(calls[0]!.args.slice(0, 4), ["-d", "BAR", "-n", "3"]);
  assert.ok(calls[0]!.args.includes("position=top-left"));
  assert.ok(calls[0]!.args.includes("fit-to-page=false"));
  assert.ok(calls[0]!.args.includes("scaling=100"));
  assert.ok(calls[0]!.args.includes("page-left=0"));
  assert.ok(calls[0]!.args.includes("page-right=0"));
});

test("maps a Dixora printer code to a differently named local printer", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const transport = new MacPrinterTransport(
    testConfig({
      printerIds: ["BAR"],
      printerNameMap: { BAR: "Bar_Epson_TM88" },
    }),
    fakeExec(calls),
    async () => 9,
  );

  await transport.print(job());

  assert.equal(calls[0]!.args[1], "Bar_Epson_TM88");
});

test("refuses to print to a printer this bridge was not configured for", async () => {
  const transport = new MacPrinterTransport(
    testConfig({ printerIds: ["MUTFAK"] }),
    fakeExec([]),
    async () => 9,
  );

  await assert.rejects(
    transport.print(job({ printerDeviceId: "BAR" })),
    PrinterNotConfiguredError,
  );
});

test("reports the macos transport in the print result", async () => {
  const transport = new MacPrinterTransport(
    testConfig({ printerIds: ["BAR"] }),
    fakeExec([]),
    async () => 9,
  );

  const result = await transport.print(job());

  assert.equal(result.transport, "macos");
  assert.ok(result.externalReference.includes("BAR-123"));
});

test("CUPS cancellation is an uncertain failure even though lp accepted the job", async () => {
  let submitted = 0;
  const transport = new MacPrinterTransport(
    testConfig({ printerIds: ["BAR"] }),
    async () => {
      submitted++;
      return { stdout: "request id is BAR-123 (1 file(s))\n", stderr: "" };
    },
    async () => 7,
  );
  await assert.rejects(transport.print(job()), /iptal edildi/);
  assert.equal(submitted, 1);
});

test("an accepted CUPS job with an unreadable status cannot be reported as PRINTED", async () => {
  const transport = new MacPrinterTransport(
    testConfig({ printerIds: ["BAR"] }),
    fakeExec([]),
    async () => {
      throw new Error("CUPS unavailable");
    },
  );
  await assert.rejects(transport.print(job()), /CUPS unavailable/);
});

test("discovery parses printer names out of lpstat -p output", async () => {
  const discovery = new MacPrinterDiscovery(async () => ({
    stdout:
      "printer MUTFAK is idle.  enabled since Sun 06 Sep 2026\n" +
      "printer BAR disabled since Sun 06 Sep 2026 -\n" +
      "\tReason unknown\n",
    stderr: "",
  }));

  const names = await discovery.listPrinters();

  assert.deepEqual(names, ["MUTFAK", "BAR"]);
});

test("discovery returns nothing when no printers are installed", async () => {
  const discovery = new MacPrinterDiscovery(async () => ({
    stdout: "no destinations added.\n",
    stderr: "",
  }));

  assert.deepEqual(await discovery.listPrinters(), []);
});
