import assert from "node:assert/strict";
import test from "node:test";

import type { PrintJobClaim } from "@dixora/shared-types";

import type { ExecFn } from "./process-exec.js";
import { PrinterNotConfiguredError } from "./printer-transport.js";
import { testConfig } from "./test-helpers.js";
import { WindowsPrinterDiscovery, WindowsPrinterTransport } from "./windows-printer.js";

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

function fakeExec(calls: Array<{ command: string; args: readonly string[] }>): ExecFn {
  return async (command, args) => {
    calls.push({ command, args });
    return { stdout: "", stderr: "" };
  };
}

test("prints through Out-Printer, once per copy, by the printer's own name", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const transport = new WindowsPrinterTransport(
    testConfig({ printerIds: ["MUTFAK"] }),
    fakeExec(calls),
  );

  await transport.print(job({ copies: 2 }));

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.command, "powershell.exe");
    assert.match(call.args.join(" "), /Out-Printer -Name 'MUTFAK'/);
  }
});

test("maps a Dixora printer code to a differently named local printer", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const transport = new WindowsPrinterTransport(
    testConfig({
      printerIds: ["MUTFAK"],
      printerNameMap: { MUTFAK: "Kitchen (EPSON TM-T88)" },
    }),
    fakeExec(calls),
  );

  await transport.print(job());

  assert.match(calls[0]!.args.join(" "), /Out-Printer -Name 'Kitchen \(EPSON TM-T88\)'/);
});

test("escapes an embedded single quote in the local printer name", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const transport = new WindowsPrinterTransport(
    testConfig({
      printerIds: ["MUTFAK"],
      printerNameMap: { MUTFAK: "Ali's Kitchen Printer" },
    }),
    fakeExec(calls),
  );

  await transport.print(job());

  assert.match(calls[0]!.args.join(" "), /Ali''s Kitchen Printer/);
});

test("refuses to print to a printer this bridge was not configured for", async () => {
  const transport = new WindowsPrinterTransport(
    testConfig({ printerIds: ["BAR"] }),
    fakeExec([]),
  );

  await assert.rejects(
    transport.print(job({ printerDeviceId: "MUTFAK" })),
    PrinterNotConfiguredError,
  );
});

test("reports the windows transport in the print result", async () => {
  const transport = new WindowsPrinterTransport(
    testConfig({ printerIds: ["MUTFAK"] }),
    fakeExec([]),
  );

  const result = await transport.print(job());

  assert.equal(result.transport, "windows");
});

test("discovery parses one printer name per Get-Printer line", async () => {
  const discovery = new WindowsPrinterDiscovery(async () => ({
    stdout: "MUTFAK\r\nBAR\r\nMicrosoft Print to PDF\r\n",
    stderr: "",
  }));

  const names = await discovery.listPrinters();

  assert.deepEqual(names, ["MUTFAK", "BAR", "Microsoft Print to PDF"]);
});
