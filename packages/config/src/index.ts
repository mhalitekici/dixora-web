export const SERVICE_PORTS = Object.freeze({
  web: 3000,
  api: 8000,
  postgres: 5432,
  redis: 6379,
  minioApi: 9000,
  minioConsole: 9001,
  printBridge: 9100,
});

export const API_PATHS = Object.freeze({
  versionRoot: "/api/v1",
  health: "/health",
  printJobs: "/api/v1/printing/jobs",
  websocket: "/api/v1/realtime/ws",
});

export type EnvironmentName = "development" | "test" | "staging" | "production";

export function requireEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = environment[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function readEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: string,
): string {
  return environment[key]?.trim() || fallback;
}

export function readInteger(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  const rawValue = environment[key]?.trim();
  const value = rawValue ? Number.parseInt(rawValue, 10) : fallback;

  if (!Number.isSafeInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${key} must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${key} must be at most ${options.max}`);
  }

  return value;
}

export function readFloat(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  const rawValue = environment[key]?.trim();
  const value = rawValue ? Number.parseFloat(rawValue) : fallback;

  if (!Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${key} must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${key} must be at most ${options.max}`);
  }

  return value;
}

export function readBoolean(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: boolean,
): boolean {
  const rawValue = environment[key]?.trim().toLowerCase();

  if (!rawValue) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(rawValue)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(rawValue)) {
    return false;
  }

  throw new Error(`${key} must be a boolean`);
}

export function readCsv(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: readonly string[] = [],
): string[] {
  const rawValue = environment[key]?.trim();
  if (!rawValue) {
    return [...fallback];
  }

  return [
    ...new Set(
      rawValue
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
