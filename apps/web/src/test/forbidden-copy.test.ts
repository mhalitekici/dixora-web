import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * Guards two copy decisions across every customer-facing source file, so a
 * future edit cannot quietly reintroduce either:
 *   - the "no credit card required" marketing hook, in any of its common
 *     Turkish/English phrasings;
 *   - a price advertised as VAT-exclusive ("+ KDV" / "KDV hariç").
 *
 * Scoped to marketing/registration/legal source (not the whole repo) because
 * those are the only surfaces a prospect reads before signing up, and because
 * scanning everything would also flag legitimate, unrelated uses of the word
 * "kart" (e.g. saved payment cards in the billing dashboard).
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SCAN_DIRS = [
  join(ROOT, "components", "marketing"),
  join(ROOT, "components", "legal"),
  join(ROOT, "components", "admin", "subscription-settings.tsx"),
  join(ROOT, "components", "super-admin"),
  join(ROOT, "lib", "pricing.ts"),
]

const FORBIDDEN_PATTERNS: RegExp[] = [
  /kredi kartı gerekmez/i,
  /kredi kartı gerektirmez/i,
  /kart bilgisi gerekmez/i,
  /no credit card required/i,
  /credit card not required/i,
  /kdv hariç/i,
  /\+\s*kdv\b/i,
]

function collectSourceFiles(path: string): string[] {
  const stats = statSync(path)
  if (stats.isFile()) {
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : []
  }
  return readdirSync(path).flatMap((entry) => {
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) {
      return []
    }
    return collectSourceFiles(join(path, entry))
  })
}

describe("forbidden marketing copy", () => {
  const files = SCAN_DIRS.flatMap(collectSourceFiles)

  it("scans a non-trivial number of files", () => {
    // A guard on the guard: an empty scan would pass everything silently.
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(files)("%s carries no forbidden phrase", (file) => {
    const content = readFileSync(file, "utf-8")
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(content).not.toMatch(pattern)
    }
  })
})
