import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PrintJobClaim, PrintResult } from "@dixora/shared-types";

import type { BridgeConfig } from "./config.js";
import { log } from "./logger.js";
import {
  PrinterNotConfiguredError,
  type PrinterDiscovery,
  type PrinterTransport,
} from "./printer-transport.js";
import { runProcess, type ExecFn } from "./process-exec.js";
import { renderReceiptText } from "./receipt-text.js";
import { cupsJobState } from "./cups-job.js";

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
    private readonly jobState: (
      jobId: number,
    ) => Promise<number> = cupsJobState,
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
    const text = renderReceiptText(job, this.config.receiptColumns);

    const dir = await mkdtemp(join(tmpdir(), "dixora-print-"));
    const file = join(dir, `${randomUUID()}.txt`);
    let cupsReference = "";
    try {
      await writeFile(file, text, { encoding: "utf8" });
      const submitted = await this.exec(
        "lp",
        [
          "-d",
          localPrinterName,
          "-n",
          String(job.copies),
          "-o",
          "position=top-left",
          "-o",
          "fit-to-page=false",
          "-o",
          "scaling=100",
          "-o",
          "page-left=0",
          "-o",
          "page-right=0",
          "-h",
          "localhost:631",
          "--",
          file,
        ],
        { timeoutMs: 20_000, env: { ...process.env, LC_ALL: "C", LANG: "C" } },
      );
      const reference = /request id is (\S+)-(\d+)\s/.exec(submitted.stdout);
      if (!reference)
        throw new Error("CUPS işi gönderildi ancak iş kimliği doğrulanamadı");
      cupsReference = `${reference[1]}-${reference[2]}`;
      const jobId = Number(reference[2]);
      if (!Number.isSafeInteger(jobId) || jobId < 1)
        throw new Error("Geçersiz CUPS iş kimliği");
      const deadline = Date.now() + 60_000;
      for (;;) {
        const state = await this.jobState(jobId);
        if (state === 9) break;
        if (state === 6 || state === 7 || state === 8) {
          throw new Error(
            `CUPS işi durdu veya iptal edildi (${cupsReference}, durum ${state}); fiziksel çıktıyı kontrol edin`,
          );
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `CUPS sonucu belirsiz (${cupsReference}); fiziksel çıktıyı kontrol edin`,
          );
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
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
      externalReference: [
        cupsReference,
        this.config.bridgeId,
        printerCode,
        job.id,
        job.attemptCount,
      ].join(":"),
      printedAt: new Date().toISOString(),
      transport: "macos",
    };
  }
}

export class MacPrinterDiscovery implements PrinterDiscovery {
  public constructor(private readonly exec: ExecFn = runProcess) {}

  public async listPrinters(): Promise<string[]> {
    const { stdout } = await this.exec(
      "lpstat",
      ["-h", "localhost:631", "-p"],
      {
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
      },
    );
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
