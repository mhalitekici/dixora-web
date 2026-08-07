import type { PrintJobClaim, PrintResult } from "@dixora/shared-types";

import type { BridgeConfig } from "./config.js";
import { log } from "./logger.js";

export interface PrinterTransport {
  print(job: PrintJobClaim): Promise<PrintResult>;
}

export interface MockPrinterOptions {
  delay?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export class MockPrinterTransport implements PrinterTransport {
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly printerIds: ReadonlySet<string>;

  public constructor(
    private readonly config: BridgeConfig,
    options: MockPrinterOptions = {},
  ) {
    this.delay =
      options.delay ??
      ((milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }));
    this.random = options.random ?? Math.random;
    this.printerIds = new Set(config.printerIds);
  }

  public async print(job: PrintJobClaim): Promise<PrintResult> {
    if (!this.printerIds.has(job.printerDeviceId)) {
      throw new Error(`Printer '${job.printerDeviceId}' is not configured`);
    }

    log("info", "mock_print_started", {
      jobId: job.id,
      printerDeviceId: job.printerDeviceId,
      orderId: job.orderId,
      copies: job.copies,
      isReprint: job.isReprint,
    });

    await this.delay(this.config.mockDelayMs);

    if (this.random() < this.config.mockFailureRate) {
      throw new Error("Configured mock printer failure");
    }

    const result: PrintResult = {
      externalReference: [
        this.config.bridgeId,
        job.printerDeviceId,
        job.id,
        job.attemptCount,
      ].join(":"),
      printedAt: new Date().toISOString(),
      transport: "mock",
    };

    log("info", "mock_print_completed", {
      jobId: job.id,
      externalReference: result.externalReference,
    });

    return result;
  }
}
