import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PrintJobClaim, PrintResult } from "@dixora/shared-types";

import type { BridgeConfig } from "./config.js";
import { log } from "./logger.js";
import { PrinterNotConfiguredError, type PrinterDiscovery, type PrinterTransport } from "./printer-transport.js";
import { runProcess, type ExecFn } from "./process-exec.js";
import { renderReceiptText } from "./receipt-text.js";

/**
 * Prints through the Windows print spooler via PowerShell's `Out-Printer`.
 *
 * `Out-Printer` ships with every Windows install (part of PowerShell itself)
 * and hands the job to whatever driver the OS already has for the named
 * printer — USB or network, any brand — so there is nothing here to install,
 * update or go unmaintained. The trade-off is that it is a *text* print path,
 * not raw ESC/POS: see docs/printing.md "Known limits" for what that costs
 * (no programmatic paper cut).
 *
 * A temp file carries the receipt text rather than piping it directly,
 * because `Out-Printer` reads from the pipeline and PowerShell's default
 * console encoding on Windows has historically mangled non-ASCII text passed
 * as a command-line argument; reading a UTF-8 file with an explicit encoding
 * does not have that problem.
 */
export class WindowsPrinterTransport implements PrinterTransport {
  private readonly printerCodes: ReadonlySet<string>;

  public constructor(
    private readonly config: BridgeConfig,
    private readonly exec: ExecFn = runProcess,
  ) {
    this.printerCodes = new Set(config.printerIds);
  }

  public async print(job: PrintJobClaim): Promise<PrintResult> {
    const printerCode = job.printerDeviceId;
    if (this.printerCodes.size > 0 && !this.printerCodes.has(printerCode)) {
      throw new PrinterNotConfiguredError(printerCode);
    }
    const localPrinterName =
      job.localPrinterName ??
      this.config.printerNameMap[printerCode] ??
      printerCode;
    assertSupportedWindowsPrinter(localPrinterName);
    const text = renderReceiptText(job);

    const dir = await mkdtemp(join(tmpdir(), "dixora-print-"));
    const file = join(dir, `${randomUUID()}.txt`);
    try {
      await writeFile(file, text, { encoding: "utf8" });
      for (let copy = 0; copy < job.copies; copy += 1) {
        log("info", "windows_spool_command_started", {
          jobId: job.id,
          printerCode,
          localPrinterName,
          copy: copy + 1,
          copies: job.copies,
        });
        await this.exec(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Get-Content -LiteralPath '${escapeSingleQuoted(file)}' -Raw -Encoding UTF8 | Out-Printer -Name '${escapeSingleQuoted(localPrinterName)}'`,
          ],
          { timeoutMs: 20_000 },
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    log("info", "windows_print_completed", {
      jobId: job.id,
      printerCode,
      localPrinterName,
      copies: job.copies,
    });

    return {
      externalReference: [this.config.bridgeId, printerCode, job.id, job.attemptCount].join(":"),
      printedAt: new Date().toISOString(),
      transport: "windows",
    };
  }
}

export class WindowsPrinterDiscovery implements PrinterDiscovery {
  public constructor(private readonly exec: ExecFn = runProcess) {}

  public async listPrinters(): Promise<string[]> {
    const { stdout } = await this.exec("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-Printer | Select-Object -ExpandProperty Name",
    ]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}

function escapeSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function assertSupportedWindowsPrinter(localPrinterName: string): void {
  const normalized = localPrinterName.trim().toLowerCase();
  if (
    normalized === "microsoft print to pdf" ||
    normalized === "microsoft xps document writer"
  ) {
    throw new Error(
      `${localPrinterName} sanal bir dosya yazıcısıdır. Dixora Print Bridge arka planda çalıştığı için kaydetme penceresi gösteremez; gerçek bir yazıcı veya önceden dosya adı istemeyen bir test yazıcısı seçin.`,
    );
  }
}
