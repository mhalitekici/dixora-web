import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFn = (
  command: string,
  args: readonly string[],
  options?: { timeoutMs?: number },
) => Promise<ExecResult>;

/** Thin, timeout-bound wrapper around `child_process.execFile`.
 *
 * Kept as a single seam (`ExecFn`) so every OS transport and discovery class
 * takes one as a constructor argument — production code passes this real
 * implementation, tests pass a fake, and neither needs to touch a real
 * printer or a real subprocess.
 */
export const runProcess: ExecFn = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args as string[],
      { timeout: options.timeoutMs ?? 15_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${command} ${args.join(" ")} failed: ${error.message}${
                stderr ? ` (${stderr.trim()})` : ""
              }`,
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
