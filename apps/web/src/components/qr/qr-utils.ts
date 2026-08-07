import type { CartLine } from "@/stores/cart-store"

export function decimalToMinor(
  value: string,
  fractionDigits = 2,
): bigint {
  const normalized = value.trim()
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized)
  if (!match) {
    return BigInt(0)
  }

  const sign = match[1] === "-" ? -BigInt(1) : BigInt(1)
  const whole = BigInt(match[2])
  const fraction = (match[3] ?? "")
    .padEnd(fractionDigits, "0")
    .slice(0, fractionDigits)
  const scale = BigInt(10) ** BigInt(fractionDigits)
  return sign * (whole * scale + BigInt(fraction || "0"))
}

export function cartLineTotalMinor(line: CartLine): bigint {
  const modifiers = line.modifiers.reduce(
    (total, modifier) => total + decimalToMinor(modifier.priceDelta),
    BigInt(0),
  )
  return (decimalToMinor(line.unitPrice) + modifiers) * BigInt(line.quantity)
}

export function cartTotalMinor(lines: readonly CartLine[]): bigint {
  return lines.reduce(
    (total, line) => total + cartLineTotalMinor(line),
    BigInt(0),
  )
}

export function formatMinorMoney(
  minor: bigint,
  currency: string,
  locale = "tr-TR",
): string {
  const amount = Number(minor) / 100
  return new Intl.NumberFormat(locale, {
    currency,
    style: "currency",
  }).format(amount)
}

export function readableForeground(hex: string): "#111111" | "#ffffff" {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) {
    return "#ffffff"
  }

  const value = match[1]
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000
  return luminance >= 150 ? "#111111" : "#ffffff"
}

export function requestStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: "Onay bekliyor",
    APPROVED: "Onaylandı",
    REJECTED: "Reddedildi",
    EXPIRED: "Süresi doldu",
  }
  return labels[status] ?? status
}

export function safeFileName(value: string): string {
  return (
    value
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/[^a-z0-9çğıöşü]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "qr-kodu"
  )
}
