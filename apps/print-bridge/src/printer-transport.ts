import type { PrintJobClaim, PrintResult } from "@dixora/shared-types";

/**
 * What every printer transport (mock, Windows, macOS) implements.
 *
 * Deliberately narrow: `print` is the only thing the bridge's job loop needs,
 * so a new OS target is exactly one small class away without touching
 * `bridge.ts` at all.
 */
export interface PrinterTransport {
  print(job: PrintJobClaim): Promise<PrintResult>;
}

/** Reports the printer names the OS currently knows about, by their exact
 * spelling — the same string an operator types into "Local printer" when
 * mapping a Dixora printer code to a physical device. */
export interface PrinterDiscovery {
  listPrinters(): Promise<string[]>;
}

export class PrinterNotConfiguredError extends Error {
  public constructor(printerCode: string) {
    super(`Printer '${printerCode}' is not configured on this bridge`);
    this.name = "PrinterNotConfiguredError";
  }
}
