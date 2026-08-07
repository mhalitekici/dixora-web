const PUBLIC_PATH_PREFIXES = [
  "public/",
  "catalog/public/",
  "qr/public/",
  "qr-menu/public/",
  "loyalty/public/",
] as const

const PUBLIC_PRODUCT_MEDIA_PATH =
  /^media\/products\/[0-9a-f]{24}\/[0-9a-f]{32}\.(?:jpg|png|webp)$/i
const PUBLIC_QR_MEDIA_PATH =
  /^media\/qr-menu\/[0-9a-f]{24}\/[0-9a-f]{24}\/(?:logo|cover)\/[0-9a-f]{32}\.(?:jpg|png|webp)$/i

export function isPublicBackendRequest(path: string, method: string): boolean {
  const normalized = path.toLowerCase()
  if (PUBLIC_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true
  }

  if (method !== "GET" && method !== "HEAD") {
    return false
  }

  return (
    PUBLIC_PRODUCT_MEDIA_PATH.test(normalized) ||
    PUBLIC_QR_MEDIA_PATH.test(normalized)
  )
}
