import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { PrintJobClaim, PrintResult } from "@dixora/shared-types";

import { log } from "./logger.js";

/**
 * One physically-printed job's durable record.
 *
 * `documentHash` exists for operators/support to confirm after the fact that
 * a recovered acknowledgement really does correspond to the receipt that came
 * out of the printer, not a coincidentally-reused job id.
 */
export interface JournalEntry {
  jobId: string;
  attemptCount: number;
  printerCode: string;
  documentHash: string;
  state: "DISPATCHING" | "PRINTED";
  result: PrintResult | null;
  /** True once the API has confirmed the PRINTED transition. A bridge that
   * restarts before this flips retries the acknowledgement, never the print. */
  acknowledged: boolean;
  recordedAt: string;
}

/**
 * Crash-safe local record of every job this bridge has physically printed.
 *
 * This is what turns "the printer succeeded but the network died right after"
 * from a duplicate-print risk into a solved problem: on restart, the journal
 * is loaded before the first poll, so if the API ever hands this job back
 * (lease expiry, a retried claim), the bridge recognizes it was already
 * printed and only retries the acknowledgement.
 *
 * Written with a write-to-temp-then-rename on every change rather than
 * appended to in place, so a crash mid-write never leaves a half-written,
 * unparsable journal file behind.
 */
export class PrintJournal {
  private entries = new Map<string, JournalEntry>();
  private loaded = false;

  public constructor(private readonly path: string) {}

  public async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const candidate of parsed) {
          const entry = asJournalEntry(candidate);
          if (entry) {
            this.entries.set(entry.jobId, entry);
          }
        }
      }
      log("info", "journal_loaded", { entries: this.entries.size, path: this.path });
    } catch (error) {
      if (isNotFound(error)) {
        log("info", "journal_not_found_starting_empty", { path: this.path });
      } else {
        // A corrupt or unreadable journal must never block startup — printing
        // is the whole point of this process, and an empty journal is a safe
        // (if imperfect) fallback: worst case, one job is reprinted once.
        log("warn", "journal_load_failed_starting_empty", {
          path: this.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.loaded = true;
  }

  public get(jobId: string, attemptCount?: number): JournalEntry | undefined {
    const entry = this.entries.get(jobId);
    if (attemptCount !== undefined && entry?.attemptCount !== attemptCount) {
      return undefined;
    }
    return entry;
  }

  /** Acknowledged entries are historical evidence only. An explicit manager
   * retry may reuse the same job id with a new attempt, so only an unresolved
   * entry is allowed to suppress a physical print. */
  public getUnacknowledged(jobId: string): JournalEntry | undefined {
    const entry = this.entries.get(jobId);
    return entry && !entry.acknowledged ? entry : undefined;
  }

  public async recordDispatching(job: PrintJobClaim): Promise<void> {
    this.entries.set(job.id, {
      jobId: job.id,
      attemptCount: job.attemptCount,
      printerCode: String(job.printerDeviceId),
      documentHash: hashDocument(job),
      state: "DISPATCHING",
      result: null,
      acknowledged: false,
      recordedAt: new Date().toISOString(),
    });
    await this.persist();
  }

  public async recordPrinted(
    job: PrintJobClaim,
    result: PrintResult,
  ): Promise<void> {
    const current = this.get(job.id, job.attemptCount);
    this.entries.set(job.id, {
      jobId: job.id,
      attemptCount: job.attemptCount,
      printerCode: String(job.printerDeviceId),
      documentHash: hashDocument(job),
      state: "PRINTED",
      result,
      acknowledged: false,
      recordedAt: current?.recordedAt ?? new Date().toISOString(),
    });
    await this.persist();
  }

  public async markAcknowledged(jobId: string): Promise<void> {
    const entry = this.entries.get(jobId);
    if (!entry || entry.acknowledged) return;
    entry.acknowledged = true;
    await this.persist();
  }

  /** Entries printed but never confirmed with the API — retried first, before
   * any new job is claimed. */
  public unacknowledged(): JournalEntry[] {
    return [...this.entries.values()].filter((entry) => !entry.acknowledged);
  }

  public size(): number {
    return this.entries.size;
  }

  private async persist(): Promise<void> {
    if (!this.loaded) return; // never overwrite a journal we have not read yet
    const trimmed = this.trimToLimit();
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.tmp-${process.pid}`;
    await writeFile(tempPath, JSON.stringify(trimmed), "utf8");
    await rename(tempPath, this.path);
  }

  /** Bounded so a bridge left running for months does not grow this file
   * without limit; acknowledged entries are the safe ones to drop first. */
  private trimToLimit(limit = 2_000): JournalEntry[] {
    const all = [...this.entries.values()];
    if (all.length <= limit) return all;
    const unacked = all.filter((entry) => !entry.acknowledged);
    const acked = all
      .filter((entry) => entry.acknowledged)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    const kept = [...unacked, ...acked].slice(0, limit);
    this.entries = new Map(kept.map((entry) => [entry.jobId, entry]));
    return kept;
  }
}

export function hashDocument(job: PrintJobClaim): string {
  return createHash("sha256")
    .update(JSON.stringify(job.document))
    .digest("hex");
}

function asJournalEntry(value: unknown): JournalEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.jobId !== "string" ||
    typeof record.attemptCount !== "number" ||
    typeof record.printerCode !== "string" ||
    typeof record.documentHash !== "string" ||
    typeof record.acknowledged !== "boolean" ||
    typeof record.recordedAt !== "string"
  ) {
    return null;
  }
  if (!("state" in record)) {
    if (typeof record.result !== "object" || record.result === null) return null;
    return { ...(record as unknown as JournalEntry), state: "PRINTED" };
  }
  if (record.state === "DISPATCHING" && record.result === null) {
    return record as unknown as JournalEntry;
  }
  if (record.state === "PRINTED" && typeof record.result === "object" && record.result !== null) {
    return record as unknown as JournalEntry;
  }
  return null;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
