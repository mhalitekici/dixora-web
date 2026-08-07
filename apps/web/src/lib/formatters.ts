import { formatDistanceToNowStrict, isValid, parseISO } from "date-fns"
import { tr } from "date-fns/locale"

const DEFAULT_LOCALE = "tr-TR"
const DEFAULT_CURRENCY = "TRY"

export function formatMoney(
  value: string | number | null | undefined,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
): string {
  const amount = typeof value === "number" ? value : Number(value)

  if (!Number.isFinite(amount)) {
    return "—"
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
  }).format(amount)
}

export function formatNumber(
  value: string | number | null | undefined,
  options: Intl.NumberFormatOptions = {},
  locale = DEFAULT_LOCALE,
): string {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number)
    ? new Intl.NumberFormat(locale, options).format(number)
    : "—"
}

export function formatDateTime(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
  locale = DEFAULT_LOCALE,
): string {
  const date = toDate(value)
  return date
    ? new Intl.DateTimeFormat(locale, options).format(date)
    : "—"
}

export function formatDate(
  value: string | Date | null | undefined,
  locale = DEFAULT_LOCALE,
): string {
  return formatDateTime(value, { dateStyle: "medium" }, locale)
}

export function formatRelativeTime(
  value: string | Date | null | undefined,
): string {
  const date = toDate(value)
  return date
    ? formatDistanceToNowStrict(date, { addSuffix: true, locale: tr })
    : "—"
}

export function formatDuration(
  totalSeconds: number | null | undefined,
): string {
  if (
    totalSeconds === null ||
    totalSeconds === undefined ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds < 0
  ) {
    return "—"
  }

  const rounded = Math.floor(totalSeconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const seconds = rounded % 60

  if (hours > 0) {
    return `${hours} sa ${minutes} dk`
  }
  if (minutes > 0) {
    return `${minutes} dk ${seconds} sn`
  }
  return `${seconds} sn`
}

export function getInitials(
  name: string | null | undefined,
  fallback = "DX",
): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) {
    return fallback
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("tr-TR")
}

function toDate(value: string | Date | null | undefined): Date | null {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? parseISO(value)
        : null

  return date && isValid(date) ? date : null
}
