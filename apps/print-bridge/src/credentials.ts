import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

/** What an enrolled bridge needs to authenticate on every future run. */
export interface BridgeCredential {
  bridgeId: string;
  tenantId: string;
  branchId: string;
  name: string;
  token: string;
}

/**
 * Loads a previously enrolled credential from local disk, if one exists.
 *
 * Never throws: an unreadable or missing file just means "not enrolled yet",
 * which the caller (index.ts) turns into a clear instruction to run
 * `enroll`, not a crash.
 */
export async function loadCredential(
  path: string,
): Promise<BridgeCredential | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return asCredential(parsed);
  } catch {
    return null;
  }
}

/**
 * Saves a freshly enrolled credential, restricted to the owning OS user.
 *
 * Windows removes inherited ACLs and grants only the current account read/write
 * access through the built-in `icacls` command. macOS/Linux use `0o600`.
 */
export async function saveCredential(
  path: string,
  credential: BridgeCredential,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(credential, null, 2), "utf8");
  try {
    if (process.platform === "win32") {
      await restrictWindowsCredential(path);
    } else {
      await chmod(path, 0o600);
    }
  } catch (error) {
    await rm(path, { force: true });
    log("error", "credential_permission_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw new Error("Bridge credential could not be secured on local disk");
  }
}

async function restrictWindowsCredential(path: string): Promise<void> {
  const username = process.env.USERNAME?.trim();
  if (!username) {
    throw new Error("Windows user name is unavailable for credential ACL");
  }
  await execFileAsync(
    "icacls.exe",
    [path, "/inheritance:r", "/grant:r", `${username}:(R,W)`],
    { windowsHide: true },
  );
}

function asCredential(value: unknown): BridgeCredential | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.bridgeId !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.branchId !== "string" ||
    typeof record.name !== "string" ||
    typeof record.token !== "string"
  ) {
    return null;
  }
  return record as unknown as BridgeCredential;
}
