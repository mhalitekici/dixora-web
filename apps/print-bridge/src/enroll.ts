import { saveCredential, type BridgeCredential } from "./credentials.js";
import { PRINTING_API } from "./protocol.js";

export interface EnrollOptions {
  apiUrl: string;
  code: string;
  name: string;
  platform?: string;
  version?: string;
  credentialsPath: string;
  fetchImpl?: typeof fetch;
}

/**
 * Redeems a one-time enrollment code for a real, scoped bridge credential,
 * and saves it to local disk so every future run picks it up automatically.
 *
 * This is the whole point of the enrollment-code flow: nobody has to
 * hand-copy a long bearer token from the admin panel into a config file —
 * they read a short code off one screen and type it into this command.
 */
export async function runEnroll(options: EnrollOptions): Promise<BridgeCredential> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.apiUrl.replace(/\/+$/, "")}${PRINTING_API.enroll}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      code: options.code,
      name: options.name,
      platform: options.platform,
      version: options.version,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Enrollment failed (${response.status}): ${body.slice(0, 300) || "no response body"}`,
    );
  }

  const payload = (await response.json()) as {
    id?: unknown;
    tenant_id?: unknown;
    branch_id?: unknown;
    name?: unknown;
    token?: unknown;
  };
  if (
    typeof payload.id !== "string" ||
    typeof payload.tenant_id !== "string" ||
    typeof payload.branch_id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.token !== "string"
  ) {
    throw new Error("Enrollment response was missing required fields");
  }

  const credential: BridgeCredential = {
    bridgeId: payload.id,
    tenantId: payload.tenant_id,
    branchId: payload.branch_id,
    name: payload.name,
    token: payload.token,
  };
  await saveCredential(options.credentialsPath, credential);
  return credential;
}
