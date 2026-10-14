import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrintJobClaim } from "@dixora/shared-types";

import type { ExecFn } from "./process-exec.js";
import { PrinterNotConfiguredError } from "./printer-transport.js";
import { testConfig } from "./test-helpers.js";
import {
  WindowsPrinterDiscovery,
  WindowsPrinterTransport,
} from "./windows-printer.js";

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
    isTestPrint: false,
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

function fakeExec(
  calls: Array<{ command: string; args: readonly string[] }>,
): ExecFn {
  return async (command, args) => {
    calls.push({ command, args });
    return { stdout: "", stderr: "" };
  };
}

test("prints through the margin-free 80mm drawing script once per copy", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const transport = new WindowsPrinterTransport(
    testConfig({ printerIds: ["MUTFAK"] }),
    fakeExec(calls),
  );

  await transport.print(job({ copies: 2 }));

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.command, "powershell.exe");
    assert.ok(call.args.includes("-File"));
    assert.equal(call.args[call.args.indexOf("-PrinterName") + 1], "MUTFAK");
    assert.match(
      call.args[call.args.indexOf("-JobName") + 1] ?? "",
      /^Dixora-job-1-1-[12]$/,
    );
    assert.equal(call.args[call.args.indexOf("-Columns") + 1], "42");
    assert.ok(!call.args.includes("-Command"));
  }
});

test("gives every copy a distinct spooler document name", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const transport = new WindowsPrinterTransport(
    testConfig({ printerIds: ["MUTFAK"] }),
    fakeExec(calls),
  );

  await transport.print(job({ copies: 2, attemptCount: 3 }));

  assert.deepEqual(
    calls.map((call) => call.args[call.args.indexOf("-JobName") + 1]),
    ["Dixora-job-1-3-1", "Dixora-job-1-3-2"],
  );
});

test("preflights offline state and follows the named Windows spool job", async () => {
  let scriptText = "";
  const transport = new WindowsPrinterTransport(
    testConfig({ printerIds: ["MUTFAK"] }),
    async (_command, args) => {
      const scriptPath = args[args.indexOf("-File") + 1];
      assert.ok(scriptPath);
      scriptText = await readFile(scriptPath, "utf8");
      return { stdout: "", stderr: "" };
    },
  );

  await transport.print(job());

  assert.match(scriptText, /\.WorkOffline/);
  assert.match(scriptText, /Get-PrintJob/);
  assert.match(scriptText, /DocumentName -eq \$JobName/);
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

  assert.equal(
    calls[0]!.args[calls[0]!.args.indexOf("-PrinterName") + 1],
    "Kitchen (EPSON TM-T88)",
  );
});

test("passes an embedded single quote without command interpolation", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const transport = new WindowsPrinterTransport(
    testConfig({
      printerIds: ["MUTFAK"],
      printerNameMap: { MUTFAK: "Ali's Kitchen Printer" },
    }),
    fakeExec(calls),
  );

  await transport.print(job());

  assert.equal(
    calls[0]!.args[calls[0]!.args.indexOf("-PrinterName") + 1],
    "Ali's Kitchen Printer",
  );
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

test("rejects Microsoft Print to PDF because it requires an interactive save dialog", async () => {
  const transport = new WindowsPrinterTransport(
    testConfig({
      printerIds: ["PDF"],
      printerNameMap: { PDF: "Microsoft Print to PDF" },
    }),
    fakeExec([]),
  );

  await assert.rejects(
    transport.print(job({ printerDeviceId: "PDF" })),
    /sanal bir dosya yazıcısıdır/,
  );
});

test("rejects Microsoft XPS Document Writer because it requires an interactive save dialog", async () => {
  const transport = new WindowsPrinterTransport(
    testConfig({
      printerIds: ["XPS"],
      printerNameMap: { XPS: "Microsoft XPS Document Writer" },
    }),
    fakeExec([]),
  );

  await assert.rejects(
    transport.print(job({ printerDeviceId: "XPS" })),
    /sanal bir dosya yazıcısıdır/,
  );
});

test("discovery parses one printer name per Get-Printer line", async () => {
  const discovery = new WindowsPrinterDiscovery(async () => ({
    stdout: "MUTFAK\r\nBAR\r\nMicrosoft Print to PDF\r\n",
    stderr: "",
  }));

  const names = await discovery.listPrinters();

  assert.deepEqual(names, ["MUTFAK", "BAR", "Microsoft Print to PDF"]);
});
