import assert from "node:assert/strict";
import test from "node:test";
import { parseCupsJobState } from "./cups-job.js";

function response(state: number): Buffer {
  const name = Buffer.from("job-state");
  const lengths = Buffer.alloc(2);
  lengths.writeUInt16BE(name.length);
  const value = Buffer.alloc(4);
  value.writeInt32BE(state);
  return Buffer.concat([
    Buffer.from([2, 0, 0, 0, 0, 0, 0, 1, 2, 0x23]),
    lengths,
    name,
    Buffer.from([0, 4]),
    value,
    Buffer.from([3]),
  ]);
}

test("IPP preserves canceled and aborted states instead of treating queue disappearance as success", () => {
  for (const state of [3, 4, 5, 6, 7, 8, 9])
    assert.equal(parseCupsJobState(response(state)), state);
});
test("invalid or truncated IPP responses never imply successful printing", () => {
  assert.throws(() => parseCupsJobState(Buffer.from([])));
  assert.throws(() => parseCupsJobState(response(9).subarray(0, 19)));
  assert.throws(() => parseCupsJobState(response(42)));
  const rejected = response(9);
  rejected.writeUInt16BE(0x0406, 2);
  assert.throws(() => parseCupsJobState(rejected));
});
