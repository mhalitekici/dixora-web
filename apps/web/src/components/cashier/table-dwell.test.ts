import { describe, expect, it } from "vitest"

import { dwellMinutes, dwellUrgency, formatDwell } from "@/components/cashier/table-dwell"

describe("table dwell", () => {
  it("counts minutes from when the table was opened", () => {
    const now = Date.now()
    expect(dwellMinutes(new Date(now - 12 * 60_000).toISOString(), now)).toBe(12)
  })

  it("returns nothing rather than a wrong number when there is no timestamp", () => {
    // A missing timestamp must show no timer at all, never "0dk".
    expect(dwellMinutes(undefined, Date.now())).toBeNull()
    expect(dwellMinutes("not-a-date", Date.now())).toBeNull()
  })

  it("reserves the loudest band for genuinely long stays", () => {
    expect(dwellUrgency(5)).toBe("fresh")
    expect(dwellUrgency(50)).toBe("settled")
    expect(dwellUrgency(120)).toBe("long")
  })

  it("reads as a glanceable duration", () => {
    expect(formatDwell(12)).toBe("12dk")
    expect(formatDwell(60)).toBe("1s")
    expect(formatDwell(85)).toBe("1s 25dk")
  })
})
