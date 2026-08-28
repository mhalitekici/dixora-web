/**
 * How long a table has been sitting, and whether that is worth noticing.
 *
 * The till already showed state and amount, but not time — so a table that had
 * been waiting ninety minutes looked exactly like one seated two minutes ago.
 */

export type DwellUrgency = "fresh" | "settled" | "long"

/** Minutes since the order was opened. */
export function dwellMinutes(iso: string | undefined, now: number): number | null {
  if (!iso) return null
  const started = new Date(iso).getTime()
  if (Number.isNaN(started)) return null
  return Math.max(0, Math.floor((now - started) / 60_000))
}

/**
 * Three bands only.
 *
 * "long" is reserved for genuinely long stays: if most tables glow, staff stop
 * reading the colour at all.
 */
export function dwellUrgency(minutes: number): DwellUrgency {
  if (minutes >= 90) return "long"
  if (minutes >= 45) return "settled"
  return "fresh"
}

/** Compact label for a card: "12dk", "1s 25dk". */
export function formatDwell(minutes: number): string {
  if (minutes < 60) return `${minutes}dk`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}s` : `${hours}s ${rest}dk`
}
