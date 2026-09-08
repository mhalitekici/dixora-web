import { appendFileSync } from "node:fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

export function log(
  level: LogLevel,
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: "print-bridge",
    event,
    ...fields,
  };

  const output = JSON.stringify(record);
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }

  const logPath = process.env.PRINT_BRIDGE_LOG_PATH;
  if (logPath) {
    try {
      appendFileSync(logPath, `${output}\n`, "utf8");
    } catch {
      // Logging must never interrupt printing or acknowledgement.
    }
  }
}
