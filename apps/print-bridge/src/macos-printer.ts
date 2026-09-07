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
 * Prints through CUPS via `lp`, and discovers printers via `lpstat`.
 *
 * Both ship with every macOS install — CUPS is the OS's own print system, not
 * a dependency this project adds — so there is nothing here to maintain
 * beyond this file. Same text-based trade-off as the Windows transport: see
 * docs/printing.md "Known limits".
 */
export class MacPrinterTransport implements PrinterTransport {
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
    const text = renderReceiptText(job);

    const dir = await mkdtemp(join(tmpdir(), "dixora-print-"));
    const file = join(dir, `${randomUUID()}.txt`);
    try {
      await writeFile(file, text, { encoding: "utf8" });
      await this.exec(
        "lp",
        ["-d", localPrinterName, "-n", String(job.copies), "--", file],
        { timeoutMs: 20_000 },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    log("info", "macos_print_completed", {
      jobId: job.id,
      printerCode,
      localPrinterName,
      copies: job.copies,
    });

    return {
      externalReference: [this.config.bridgeId, printerCode, job.id, job.attemptCount].join(":"),
      printedAt: new Date().toISOString(),
      transport: "macos",
    };
  }
}

export class MacPrinterDiscovery implements PrinterDiscovery {
  public constructor(private readonly exec: ExecFn = runProcess) {}

  public async listPrinters(): Promise<string[]> {
    const { stdout } = await this.exec("lpstat", ["-p"]);
    const names: string[] = [];
    for (const line of stdout.split("\n")) {
      // `lpstat -p` prints lines like: "printer BAR is idle.  enabled since ..."
      const match = /^printer\s+(\S+)\s+/.exec(line);
      const name = match?.[1];
      if (name) {
        names.push(name);
      }
    }
    return names;
  }
}
