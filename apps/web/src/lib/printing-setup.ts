export function suggestedPrinterCode(name: string, prefix = "YAZICI") {
  const code = name
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!code) return ""
  return (/^[A-Z]/.test(code) ? code : `${prefix}-${code}`).slice(0, 50)
}

export function printBridgeApiUrl() {
  const configured =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1"
  return configured.replace(/\/api\/v\d+\/?$/, "").replace(/\/$/, "")
}
