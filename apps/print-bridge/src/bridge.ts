import type { PrintJobClaim, PrintResult } from "@dixora/shared-types";

import type { PrintBridgeApiClient } from "./api-client.js";
import type { BridgeConfig } from "./config.js";
import { log } from "./logger.js";
import type { PrinterTransport } from "./mock-printer.js";
import { safeErrorMessage } from "./protocol.js";
import type { BridgeState } from "./state.js";

const COMPLETED_CACHE_LIMIT = 1_000;

export class PrintBridge {
  private readonly completedJobs = new Map<string, PrintResult>();

  public constructor(
    private readonly config: BridgeConfig,
    private readonly api: PrintBridgeApiClient,
    private readonly printer: PrinterTransport,
    private readonly state: BridgeState,
  ) {}

  public async run(signal: AbortSignal): Promise<void> {
    log("info", "bridge_started", {
      apiUrl: this.config.apiUrl,
      bridgeId: this.config.bridgeId,
      branchId: this.config.branchId,
      printerIds: this.config.printerIds,
    });

    while (!signal.aborted) {
      await this.poll();
      await waitFor(this.config.pollIntervalMs, signal);
    }

    this.state.recordStopping();
    log("info", "bridge_stopped", { bridgeId: this.config.bridgeId });
  }

  public async poll(): Promise<void> {
    try {
      const jobs = await this.api.claimJobs();
      this.state.recordPollSuccess();

      if (jobs.length > 0) {
        log("info", "jobs_claimed", { count: jobs.length });
      }

      await Promise.all(jobs.map((job) => this.process(job)));
    } catch (error) {
      const message = safeErrorMessage(error);
      this.state.recordPollFailure(message);
      log("warn", "poll_failed", { message });
    }
  }

  private async process(job: PrintJobClaim): Promise<void> {
    const previousResult = this.completedJobs.get(job.id);
    if (previousResult) {
      try {
        await this.api.markPrinted(job, previousResult);
        log("info", "printed_ack_recovered", { jobId: job.id });
      } catch (error) {
        log("warn", "printed_ack_retry_failed", {
          jobId: job.id,
          message: safeErrorMessage(error),
        });
      }
      return;
    }

    try {
      await this.api.markSent(job);
      const result = await this.printer.print(job);

      this.rememberPrinted(job.id, result);
      this.state.recordPrinted();
      await this.api.markPrinted(job, result);
    } catch (error) {
      const message = safeErrorMessage(error);
      this.state.recordFailedJob(message);
      log("error", "job_failed", { jobId: job.id, message });

      try {
        await this.api.markFailed(job, message);
      } catch (acknowledgementError) {
        log("warn", "failed_ack_failed", {
          jobId: job.id,
          message: safeErrorMessage(acknowledgementError),
        });
      }
    }
  }

  private rememberPrinted(jobId: string, result: PrintResult): void {
    this.completedJobs.set(jobId, result);

    if (this.completedJobs.size > COMPLETED_CACHE_LIMIT) {
      const oldestJobId = this.completedJobs.keys().next().value;
      if (oldestJobId !== undefined) {
        this.completedJobs.delete(oldestJobId);
      }
    }
  }
}

async function waitFor(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
