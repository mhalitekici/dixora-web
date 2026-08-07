import type { PrintJobClaim, PrintResult } from "@dixora/shared-types";

import type { BridgeConfig } from "./config.js";
import {
  PRINTING_API,
  parseClaimedJobs,
  type BridgeUpdateRequest,
} from "./protocol.js";

export class PrintBridgeApiClient {
  public constructor(private readonly config: BridgeConfig) {}

  public async claimJobs(): Promise<PrintJobClaim[]> {
    const jobs: PrintJobClaim[] = [];

    for (let index = 0; index < this.config.maxClaim; index += 1) {
      const payload = await this.request(
        PRINTING_API.claim(
          this.config.printerIds,
          this.config.apiToken ? undefined : this.config.branchId,
        ),
        {
          method: "POST",
        },
      );
      if (payload === undefined || payload === null) {
        break;
      }
      jobs.push(...parseClaimedJobs([payload]));
    }

    return jobs;
  }

  public async markSent(job: PrintJobClaim): Promise<void> {
    const request: BridgeUpdateRequest = { error: null, status: "SENT" };
    await this.request(PRINTING_API.update(job.id), {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": this.idempotencyKey(job, "sent"),
      },
      method: "PATCH",
    });
  }

  public async markPrinted(
    job: PrintJobClaim,
    result: PrintResult,
  ): Promise<void> {
    const request: BridgeUpdateRequest = { error: null, status: "PRINTED" };
    await this.request(PRINTING_API.update(job.id), {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": this.idempotencyKey(job, "printed"),
      },
      method: "PATCH",
    });
  }

  public async markFailed(
    job: PrintJobClaim,
    errorMessage: string,
  ): Promise<void> {
    const request: BridgeUpdateRequest = {
      error: errorMessage,
      status: "FAILED",
    };
    await this.request(PRINTING_API.update(job.id), {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": this.idempotencyKey(job, "failed"),
      },
      method: "PATCH",
    });
  }

  private idempotencyKey(
    job: PrintJobClaim,
    transition: "sent" | "printed" | "failed",
  ): string {
    return [
      "print-bridge",
      this.config.bridgeId,
      job.id,
      job.attemptCount,
      transition,
    ].join(":");
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<unknown | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs,
    );

    try {
      const credential = this.config.apiToken || this.config.apiKey;
      const response = await fetch(`${this.config.apiUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
          ...(this.config.apiToken
            ? { "X-Print-Bridge-Token": this.config.apiToken }
            : this.config.apiKey
              ? { "X-Print-Bridge-Key": this.config.apiKey }
              : {}),
          "X-Dixora-Bridge-Id": this.config.bridgeId,
          ...init.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        throw new Error(
          `Dixora API returned ${response.status} for ${path}: ${body || "empty body"}`,
        );
      }
      if (response.status === 204) {
        return undefined;
      }

      const contentType = response.headers.get("content-type") ?? "";
      return contentType.includes("application/json")
        ? await response.json()
        : undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}
