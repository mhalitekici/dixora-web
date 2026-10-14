import assert from "node:assert/strict";
import test from "node:test";

import { runProcess } from "./process-exec.js";
import { safeErrorMessage } from "./protocol.js";

test("keeps the OS failure visible even when command arguments exceed the message limit", async () => {
  await assert.rejects(
    runProcess(process.execPath, [
      "-e",
      'process.stderr.write("Windows printer is set to offline mode: GENEL"); process.exit(1)',
      "temporary-path-".repeat(100),
    ]),
    (error: unknown) => {
      assert.match(
        safeErrorMessage(error),
        /Windows printer is set to offline mode: GENEL/,
      );
      assert.doesNotMatch(safeErrorMessage(error), /temporary-path/);
      return true;
    },
  );
});

test("reports an exit code when the process emits no error output", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.exit(2)"]),
    /Process exited with code 2/,
  );
});

test("reports a timeout without repeating command arguments", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 200,
    }),
    /Process timed out after 200 ms/,
  );
});
