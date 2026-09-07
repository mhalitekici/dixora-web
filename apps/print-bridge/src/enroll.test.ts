import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadCredential } from "./credentials.js";
import { runEnroll } from "./enroll.js";

function fakeFetch(
  status: number,
  body: unknown,
): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

test("redeems a code and persists the resulting credential", async (context) => {
  const dir = await mkdtemp(join(tmpdir(), "dixora-enroll-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const credentialsPath = join(dir, "credentials.json");

  const credential = await runEnroll({
    apiUrl: "http://api.test",
    code: "A7K9-4P2M",
    name: "Aleyin Mutfağı Kasa",
    platform: "windows",
    credentialsPath,
    fetchImpl: fakeFetch(201, {
      id: "bridge-1",
      tenant_id: "tenant-1",
      branch_id: "branch-1",
      name: "Aleyin Mutfağı Kasa",
      token: "pb_secret-token",
    }),
  });

  assert.equal(credential.bridgeId, "bridge-1");
  assert.equal(credential.token, "pb_secret-token");

  const saved = await loadCredential(credentialsPath);
  assert.deepEqual(saved, credential);
});

test("never writes a credential file when enrollment is rejected", async (context) => {
  const dir = await mkdtemp(join(tmpdir(), "dixora-enroll-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const credentialsPath = join(dir, "credentials.json");

  await assert.rejects(
    runEnroll({
      apiUrl: "http://api.test",
      code: "ZZZZ-ZZZZ",
      name: "Bad Code",
      credentialsPath,
      fetchImpl: fakeFetch(400, {
        error: { code: "invalid_enrollment_code", message: "nope" },
      }),
    }),
    /Enrollment failed \(400\)/,
  );

  await assert.rejects(readFile(credentialsPath));
});

test("rejects a malformed enrollment response instead of saving a broken credential", async (context) => {
  const dir = await mkdtemp(join(tmpdir(), "dixora-enroll-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const credentialsPath = join(dir, "credentials.json");

  await assert.rejects(
    runEnroll({
      apiUrl: "http://api.test",
      code: "A7K9-4P2M",
      name: "Missing Fields",
      credentialsPath,
      fetchImpl: fakeFetch(201, { id: "bridge-1" }),
    }),
    /missing required fields/,
  );
});
