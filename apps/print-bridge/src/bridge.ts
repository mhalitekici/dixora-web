import type { PrintJobClaim, PrintResult } from "@dixora/shared-types";

import type { PrintBridgeApiClient } from "./api-client.js";
import type { BridgeConfig } from "./config.js";
import { hashDocument, PrintJournal, type JournalEntry } from "./journal.js";
import { log } from "./logger.js";
import type {
  PrinterDiscovery,
  PrinterTransport,
} from "./printer-transport.js";
import { safeErrorMessage } from "./protocol.js";
import type { BridgeState } from "./state.js";

export class PrintBridge {
  private lastHeartbeatAt = 0;
  private lastPrinterInventory: readonly string[] = [];

  public constructor(
    private readonly config: BridgeConfig,
    private readonly api: PrintBridgeApiClient,
    private readonly printer: PrinterTransport,
    private readonly state: BridgeState,
    private readonly journal: PrintJournal,
    private readonly discovery?: PrinterDiscovery,
  ) {}

  public async run(signal: AbortSignal): Promise<void> {
    await this.journal.load();
    await this.recoverJournal();
    log("info", "bridge_started", {
      apiUrl: this.config.apiUrl,
      bridgeId: this.config.bridgeId,
      branchId: this.config.branchId,
      printerIds: this.config.printerIds,
      transport: this.config.transport,
      pendingAcknowledgements: this.journal.unacknowledged().length,
    });

    while (!signal.aborted) {
      await this.heartbeatIfDue();
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

      // Preserve the server's oldest-first order through the local spooler.
      // The OS ultimately serializes a printer queue too, but handing several
      // jobs to it concurrently makes ticket order unnecessarily ambiguous.
      for (const job of jobs) {
        await this.process(job);
      }
    } catch (error) {
      const message = safeErrorMessage(error);
      this.state.recordPollFailure(message);
      log("warn", "poll_failed", { message });
    }
  }

  private async heartbeatIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastHeartbeatAt < this.config.heartbeatIntervalMs) {
      return;
    }
    this.lastHeartbeatAt = now;
    let printers = this.lastPrinterInventory;
    try {
      if (this.discovery) {
        printers = await this.discovery.listPrinters();
        this.lastPrinterInventory = printers;
      }
    } catch (error) {
      // Preserve the last known inventory if OS discovery is temporarily
      // unavailable. Agent liveness must not disappear from the management
      // panel merely because a USB driver is busy for one poll.
      log("warn", "printer_discovery_failed", {
        message: safeErrorMessage(error),
      });
    }
    try {
      await this.api.heartbeat(printers);
    } catch (error) {
      // A missed heartbeat is not fatal. Polling continues so a temporary API
      // outage cannot stop local recovery once the network returns.
      log("warn", "heartbeat_failed", { message: safeErrorMessage(error) });
    }
  }

  private async process(job: PrintJobClaim): Promise<void> {
    const previousEntry = this.journal.getUnacknowledged(job.id);
    if (previousEntry) {
      await this.recoverClaimedJournalEntry(job, previousEntry);
      return;
    }

    try {
      await this.api.markSent(job);
    } catch (error) {
      // No journal entry exists yet, so this job has not crossed the local
      // spool boundary and the server may safely retry it after lease expiry.
      this.recordFailure(job, safeErrorMessage(error), false);
      return;
    }

    try {
      // Persist before crossing the OS spool boundary. If the process stops
      // after this point, restart treats the outcome as physically uncertain
      // rather than blindly producing a duplicate ticket.
      await this.journal.recordDispatching(job);
    } catch (error) {
      await this.acknowledgeFailure(
        job,
        `Yerel günlük kaydı yazılamadı: ${safeErrorMessage(error)}`,
        true,
      );
      return;
    }

    let result: PrintResult;
    try {
      result = await this.printer.print(job);
    } catch (error) {
      await this.acknowledgeFailure(
        job,
        `Yerel yazdırma sonucunun fiziksel durumu belirsiz: ${safeErrorMessage(error)}`,
        true,
      );
      return;
    }

    try {
      // Written to the durable journal before the acknowledgement call. If the
      // network fails next, restart retries the acknowledgement, never print.
      await this.journal.recordPrinted(job, result);
    } catch (error) {
      await this.acknowledgeFailure(
        job,
        `Yazdırma tamamlandı ancak yerel kayıt güvenle yazılamadı: ${safeErrorMessage(error)}`,
        true,
      );
      return;
    }

    this.state.recordPrinted();
    try {
      await this.api.markPrinted(job, result);
      await this.journal.markAcknowledged(job.id);
      this.state.recordLastPrintedAt();
    } catch (error) {
      // The journal is now the source of truth. Do not overwrite a possibly
      // successful PRINTED acknowledgement with FAILED: startup retries the
      // same idempotent acknowledgement before the next poll.
      log("warn", "printed_ack_pending", {
        jobId: job.id,
        message: safeErrorMessage(error),
      });
    }
  }

  private async recoverClaimedJournalEntry(
    job: PrintJobClaim,
    entry: JournalEntry,
  ): Promise<void> {
    if (entry.documentHash !== hashDocument(job)) {
      await this.acknowledgeFailure(
        job,
        "Yerel günlük kaydı farklı bir belgeyle eşleşti; çift baskıyı önlemek için operatör yeniden denemelidir.",
        true,
      );
      return;
    }

    try {
      if (entry.state === "PRINTED" && entry.result) {
        // An acknowledgement can be recovered against a newer server lease
        // attempt. The local journal proves the exact document was already
        // printed, so using the fresh claim avoids a second physical send.
        await this.api.markPrinted(job, entry.result);
      } else {
        await this.api.markFailed(
          job,
          "Yerel yazdırma sonucu belirsiz kaldı. Çift baskıyı önlemek için operatör yeniden denemelidir.",
          true,
        );
      }
      await this.journal.markAcknowledged(job.id);
      log("info", "journal_entry_recovered", {
        jobId: job.id,
        state: entry.state,
      });
    } catch (error) {
      log("warn", "journal_claim_recovery_pending", {
        jobId: job.id,
        message: safeErrorMessage(error),
      });
    }
  }

  private async acknowledgeFailure(
    job: PrintJobClaim,
    message: string,
    manualRetryRequired: boolean,
  ): Promise<void> {
    this.recordFailure(job, message, manualRetryRequired);
    try {
      await this.api.markFailed(job, message, manualRetryRequired);
      if (manualRetryRequired) {
        await this.journal.markAcknowledged(job.id);
      }
    } catch (acknowledgementError) {
      log("warn", "failed_ack_pending", {
        jobId: job.id,
        message: safeErrorMessage(acknowledgementError),
      });
    }
  }

  private recordFailure(
    job: PrintJobClaim,
    message: string,
    manualRetryRequired: boolean,
  ): void {
    this.state.recordFailedJob(message);
    log("error", "job_failed", {
      jobId: job.id,
      documentHash: hashDocument(job),
      manualRetryRequired,
      message,
    });
  }

  private async recoverJournal(): Promise<void> {
    for (const entry of this.journal.unacknowledged()) {
      try {
        if (entry.state === "PRINTED" && entry.result) {
          await this.api.recoverPrinted(
            entry.jobId,
            entry.attemptCount,
            entry.result,
          );
        } else {
          await this.api.recoverUncertainDispatch(
            entry.jobId,
            entry.attemptCount,
            "Yerel yazdırma sonucu bridge yeniden başlatılırken belirsiz kaldı. Çift baskıyı önlemek için operatör yeniden denemelidir.",
          );
        }
        await this.journal.markAcknowledged(entry.jobId);
        log("info", "journal_ack_recovered", {
          jobId: entry.jobId,
          state: entry.state,
        });
      } catch (error) {
        log("warn", "journal_ack_retry_failed", {
          jobId: entry.jobId,
          message: safeErrorMessage(error),
        });
      }
    }
  }
}

export { PrintJournal };

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
