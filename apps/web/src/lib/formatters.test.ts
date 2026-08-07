import { afterEach, describe, expect, it, vi } from "vitest"

import {
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatRelativeTime,
  getInitials,
} from "@/lib/formatters"

describe("formatters", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("formats monetary and numeric values while rejecting invalid input", () => {
    expect(formatMoney("1234.5", "TRY", "tr-TR")).toBe(
      new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
        currencyDisplay: "symbol",
      }).format(1234.5),
    )
    expect(
      formatNumber(0.257, { style: "percent" }, "tr-TR"),
    ).toBe(new Intl.NumberFormat("tr-TR", { style: "percent" }).format(0.257))
    expect(formatMoney("geçersiz")).toBe("—")
    expect(formatNumber(undefined)).toBe("—")
  })

  it("keeps date and relative-time output deterministic", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"))

    expect(
      formatDateTime(
        "2026-05-21T13:45:00.000Z",
        {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        },
        "en-US",
      ),
    ).toBe("May 21, 2026, 1:45 PM")
    expect(formatRelativeTime("2026-07-31T11:58:00.000Z")).toBe(
      "2 dakika önce",
    )
    expect(formatDateTime("not-a-date")).toBe("—")
  })

  it("formats durations and Turkish initials at boundary values", () => {
    expect(formatDuration(59.9)).toBe("59 sn")
    expect(formatDuration(65)).toBe("1 dk 5 sn")
    expect(formatDuration(3661)).toBe("1 sa 1 dk")
    expect(formatDuration(-1)).toBe("—")
    expect(getInitials("İpek Öztürk")).toBe("İÖ")
    expect(getInitials("   ", "DX")).toBe("DX")
  })
})
