import { mkdir, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/** A stale lock is intentionally not stolen: the operator must first verify
 * the old process and any queued physical output after an unclean shutdown. */
export async function acquireRuntimeLock(
  journalPath: string,
): Promise<() => Promise<void>> {
  const path = `${journalPath}.lock`;
  await mkdir(dirname(path), { recursive: true });
  let file;
  try {
    file = await open(path, "wx", 0o600);
  } catch (error) {
    throw new Error(
      "Print Bridge kilidi alınamadı. Diğer çalışan süreci ve önceki baskı sonucunu kontrol edin.",
      { cause: error },
    );
  }
  try {
    await file.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(path);
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await file.close();
    await unlink(path);
  };
}
