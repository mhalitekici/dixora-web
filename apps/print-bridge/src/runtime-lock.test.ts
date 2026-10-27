import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireRuntimeLock } from "./runtime-lock.js";

test("only one runtime may use a journal, and a clean stop permits restart", async (context) => {
  const dir = await mkdtemp(join(tmpdir(), "dixora-lock-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "journal.json");
  const release = await acquireRuntimeLock(path);
  await assert.rejects(acquireRuntimeLock(path), /kilidi alınamadı/);
  await release();
  const restarted = await acquireRuntimeLock(path);
  await restarted();
});
