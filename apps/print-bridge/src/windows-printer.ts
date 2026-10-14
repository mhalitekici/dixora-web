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

/**
 * Prints through the Windows print spooler with `PrintDocument`.
 *
 * `Out-Printer` uses generic text-page defaults. Some thermal drivers treat
 * that as an A4-style block and centre a narrow receipt on the roll.
 * `PrintDocument` exposes the driver's real printable bounds, so the receipt
 * starts at the left printable edge and its configured columns fill the roll.
 *
 * Temp files carry the UTF-8 receipt and drawing script, keeping Turkish text
 * out of command-line encoding and quoting paths.
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
    const text = renderReceiptText(job, this.config.receiptColumns);

    const dir = await mkdtemp(join(tmpdir(), "dixora-print-"));
    const file = join(dir, `${randomUUID()}.txt`);
    const script = join(dir, "print-80mm.ps1");
    try {
      await writeFile(file, text, { encoding: "utf8" });
      await writeFile(script, WINDOWS_80MM_PRINT_SCRIPT, { encoding: "utf8" });
      for (let copy = 0; copy < job.copies; copy += 1) {
        const jobName = `Dixora-${job.id}-${job.attemptCount}-${copy + 1}`;
        log("info", "windows_spool_command_started", {
          jobId: job.id,
          jobName,
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
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
            "-Path",
            file,
            "-PrinterName",
            localPrinterName,
            "-JobName",
            jobName,
            "-Columns",
            String(this.config.receiptColumns),
          ],
          // The PowerShell side watches the named spooler job for up to 30s.
          // Leave enough headroom for process startup and cleanup as well.
          { timeoutMs: 40_000 },
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
      externalReference: [
        this.config.bridgeId,
        printerCode,
        job.id,
        job.attemptCount,
      ].join(":"),
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

const WINDOWS_80MM_PRINT_SCRIPT = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$JobName,
  [Parameter(Mandatory = $true)][int]$Columns
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
$lines = @($content -split '\r?\n')
$script:lineIndex = 0
$document = New-Object System.Drawing.Printing.PrintDocument
$document.PrinterSettings.PrinterName = $PrinterName
$document.DocumentName = $JobName
if (-not $document.PrinterSettings.IsValid) {
  throw "Windows printer not found: $PrinterName"
}
$printerState = Get-CimInstance Win32_Printer -ErrorAction Stop |
  Where-Object { $_.Name -eq $PrinterName } |
  Select-Object -First 1
if ($null -eq $printerState) {
  throw "Windows printer state not found: $PrinterName"
}
if ($printerState.WorkOffline) {
  throw "Windows printer is set to offline mode: $PrinterName"
}

# Keep the thermal driver's paper size, remove only application margins. The
# visible clip still protects the printer's physically unprintable hard edge.
$document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$document.OriginAtMargins = $false
$document.PrintController = New-Object System.Drawing.Printing.StandardPrintController

$handler = [System.Drawing.Printing.PrintPageEventHandler] {
  param($sender, $eventArgs)

  $graphics = $eventArgs.Graphics
  $bounds = $graphics.VisibleClipBounds
  $left = $bounds.Left + 1.0
  $top = $bounds.Top + 1.0
  $usableWidth = [Math]::Max(1.0, $bounds.Width - 2.0)

  $probeFont = New-Object System.Drawing.Font('Consolas', 10.0, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
  try {
    $probe = 'M' * $Columns
    $measured = $graphics.MeasureString($probe, $probeFont, [int]::MaxValue, [System.Drawing.StringFormat]::GenericTypographic).Width
    $fontSize = [Math]::Max(7.0, [Math]::Min(11.0, 10.0 * $usableWidth / [Math]::Max(1.0, $measured)))
  }
  finally {
    $probeFont.Dispose()
  }

  $font = New-Object System.Drawing.Font('Consolas', [single]$fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
  $format = New-Object System.Drawing.StringFormat([System.Drawing.StringFormat]::GenericTypographic)
  $format.Alignment = [System.Drawing.StringAlignment]::Near
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $format.FormatFlags = $format.FormatFlags -bor [System.Drawing.StringFormatFlags]::NoWrap

  try {
    $lineHeight = $font.GetHeight($graphics) * 1.08
    $y = $top
    while ($script:lineIndex -lt $lines.Count) {
      if (($y + $lineHeight) -gt $bounds.Bottom) {
        $eventArgs.HasMorePages = $true
        return
      }
      $graphics.DrawString($lines[$script:lineIndex], $font, [System.Drawing.Brushes]::Black, $left, $y, $format)
      $script:lineIndex += 1
      $y += $lineHeight
    }
    $eventArgs.HasMorePages = $false
  }
  finally {
    $format.Dispose()
    $font.Dispose()
  }
}

$document.add_PrintPage($handler)
try {
  $document.Print()

  # PrintDocument returning means the job was accepted, not that Windows
  # actually drained it. Follow this exact document in the spooler so an
  # offline, paper-out or blocked printer is not reported as PRINTED.
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $matchingJobs = @(
      Get-PrintJob -PrinterName $PrinterName -ErrorAction Stop |
        Where-Object { $_.DocumentName -eq $JobName }
    )
    if ($matchingJobs.Count -eq 0) {
      break
    }
    foreach ($printJob in $matchingJobs) {
      $jobStatus = [string]$printJob.JobStatus
      if ($jobStatus -match 'Error|Offline|PaperOut|Blocked|UserIntervention') {
        throw "Windows print job failed ($jobStatus): $JobName"
      }
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)

  if ($matchingJobs.Count -gt 0) {
    $lastStatus = (($matchingJobs | ForEach-Object { [string]$_.JobStatus }) -join ', ')
    throw "Windows print job did not leave the spooler within 30 seconds ($lastStatus): $JobName"
  }
}
finally {
  $document.remove_PrintPage($handler)
  $document.Dispose()
}
`;
