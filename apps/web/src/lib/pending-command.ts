type Command = { path: string; body: string };

/** Retains the original endpoint and key while the response is uncertain.
 * In-memory only: this does not queue requests or claim offline support.
 */
export class PendingCommands {
  private commands = new Map<string, Command>();

  prepare(intent: string, path: string, payload: Record<string, unknown>): Command {
    let command = this.commands.get(intent);
    if (!command) {
      command = { path, body: JSON.stringify({ ...payload, idempotency_key: crypto.randomUUID() }) };
      this.commands.set(intent, command);
    }
    return command;
  }

  confirmed(intent: string): void {
    this.commands.delete(intent);
  }
}
