import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { PrintJobClaim, PrintResult } from "@dixora/shared-types";

import { hashDocument, PrintJournal } from "./journal.js";

function job(overrides: Partial<PrintJobClaim> = {}): PrintJobClaim {
  return {
    id: "job-1",
    tenantId: "tenant-1",
    branchId: "branch-1",
    printerDeviceId: "MUTFAK",
    preparationStationId: "station-1",
    orderId: "order-1",
    kitchenTicketId: "ticket-1",
    contentType: "application/vnd.dixora.receipt+json",
    copies: 1,
    isReprint: false,
    attemptCount: 1,
    claimedAt: "2026-09-06T19:42:00Z",
    document: {
      title: "MUTFAK",
      branchName: "Aleyin Mutfağı",
      stationName: "Mutfak",
      orderNumber: "A1042",
      submittedAt: "2026-09-06T19:42:00Z",
      lines: [{ name: "Adana Kebap", quantity: "1" }],
    },
    ...overrides,
  };
}

const result: PrintResult = {
  externalReference: "bridge-1:MUTFAK:job-1:1",
  printedAt: "2026-09-06T19:42:02Z",
  transport: "mock",
};

async function tempPath(context: { after: (fn: () => unknown) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dixora-journal-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "journal.json");
}

test("a freshly printed job starts unacknowledged", async (context) => {
  const path = await tempPath(context);
  const journal = new PrintJournal(path);
  await journal.load();

  await journal.recordPrinted(job(), result);

  assert.equal(journal.get("job-1")?.acknowledged, false);
  assert.deepEqual(
    journal.unacknowledged().map((entry) => entry.jobId),
    ["job-1"],
  );
});

test("acknowledging removes the job from the retry set", async (context) => {
  const path = await tempPath(context);
  const journal = new PrintJournal(path);
  await journal.load();
  await journal.recordPrinted(job(), result);

  await journal.markAcknowledged("job-1");

  assert.equal(journal.get("job-1")?.acknowledged, true);
  assert.deepEqual(journal.unacknowledged(), []);
});

test("survives a restart: a new instance reads what the old one wrote", async (context) => {
  const path = await tempPath(context);
  const first = new PrintJournal(path);
  await first.load();
  await first.recordPrinted(job(), result);

  const second = new PrintJournal(path);
  await second.load();

  assert.equal(
    second.get("job-1")?.result?.externalReference,
    result.externalReference,
  );
  assert.equal(second.unacknowledged().length, 1);
});

test("a corrupt journal file is treated as empty rather than crashing startup", async (context) => {
  const path = await tempPath(context);
  await writeFile(path, "{not valid json", "utf8");

  const journal = new PrintJournal(path);
  await journal.load();

  assert.equal(journal.size(), 0);
});

test("a missing journal file is treated as empty", async (context) => {
  const path = await tempPath(context);
  const journal = new PrintJournal(path);

  await journal.load();

  assert.equal(journal.size(), 0);
});

test("records a document hash so a recovered entry can be verified later", () => {
  const hashA = hashDocument(job());
  const hashB = hashDocument(job({ document: { ...job().document, orderNumber: "A9999" } }));

  assert.equal(hashA.length, 64);
  assert.notEqual(hashA, hashB);
});

test("records an in-progress dispatch before asking the operating system to print", async (context) => {
  const path = await tempPath(context);
  const journal = new PrintJournal(path);
  await journal.load();

  await journal.recordDispatching(job());

  const entry = journal.get("job-1", 1);
  assert.equal(entry?.state, "DISPATCHING");
  assert.equal(entry?.result, null);
  assert.equal(entry?.acknowledged, false);
});

test("recording before load() completes never overwrites an unread on-disk journal", async (context) => {
  const path = await tempPath(context);
  const onDisk = JSON.stringify([
    {
      jobId: "earlier-job",
      attemptCount: 1,
      printerCode: "BAR",
      documentHash: "abc",
      result,
      acknowledged: false,
      recordedAt: "2026-09-06T19:00:00Z",
    },
  ]);
  await writeFile(path, onDisk, "utf8");

  // A bridge bug — recording before `load()` has resolved — must not blow
  // away the entry already on disk with a write containing only the new one.
  const journal = new PrintJournal(path);
  await journal.recordPrinted(job(), result);

  assert.equal(await readFile(path, "utf8"), onDisk);
});
