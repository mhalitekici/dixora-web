export type BridgeStatus = "starting" | "ok" | "degraded" | "stopping";

export interface BridgeHealthSnapshot {
  bridgeId: string;
  failedJobs: number;
  lastError: string | null;
  lastSuccessfulPollAt: string | null;
  processedJobs: number;
  startedAt: string;
  status: BridgeStatus;
}

export class BridgeState {
  private failedJobs = 0;
  private lastError: string | null = null;
  private lastSuccessfulPollAt: string | null = null;
  private processedJobs = 0;
  private readonly startedAt = new Date().toISOString();
  private status: BridgeStatus = "starting";

  public constructor(private readonly bridgeId: string) {}

  public recordPollSuccess(): void {
    this.status = "ok";
    this.lastError = null;
    this.lastSuccessfulPollAt = new Date().toISOString();
  }

  public recordPollFailure(message: string): void {
    this.status = "degraded";
    this.lastError = message;
  }

  public recordPrinted(): void {
    this.processedJobs += 1;
  }

  public recordFailedJob(message: string): void {
    this.failedJobs += 1;
    this.lastError = message;
  }

  public recordStopping(): void {
    this.status = "stopping";
  }

  public snapshot(): BridgeHealthSnapshot {
    return {
      bridgeId: this.bridgeId,
      failedJobs: this.failedJobs,
      lastError: this.lastError,
      lastSuccessfulPollAt: this.lastSuccessfulPollAt,
      processedJobs: this.processedJobs,
      startedAt: this.startedAt,
      status: this.status,
    };
  }
}
