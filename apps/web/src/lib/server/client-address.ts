import "server-only"

import { isIP } from "node:net"

/**
 * The caller's real IP address, for the API to rate-limit and audit on.
 *
 * Every browser request reaches the API through this server, so without this
 * the API sees one address — this container's — for the whole internet. Login
 * throttling then counts every customer against a single bucket, and the audit
 * trail records the proxy instead of the person.
 *
 * The value is taken from the LAST entry of `X-Forwarded-For`, which is the hop
 * our own reverse proxy appended and therefore the only one it observed itself.
 * Anything a client puts in that header stays to the left of it and is ignored,
 * so a forged header cannot pick its own address. This holds only while the app
 * is reachable exclusively through that proxy — see the deployment guide.
 */
export function clientAddress(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((hop) => normalizeAddress(hop))
      .filter((hop): hop is string => hop !== null)
    const nearest = hops.at(-1)
    if (nearest) {
      return nearest
    }
  }

  return normalizeAddress(request.headers.get("x-real-ip") ?? "")
}

/**
 * Headers that carry the caller's address to the API.
 *
 * Empty when the address is unknown: sending an empty or unparseable header
 * would tell the API to trust a value that means nothing, and it falls back to
 * the connecting socket instead.
 */
export function clientAddressHeaders(request: Request): Record<string, string> {
  const address = clientAddress(request)
  return address ? { "x-forwarded-for": address } : {}
}

function normalizeAddress(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  // IPv6 arrives bracketed when a port is attached; the port itself is noise
  // here because only the host is ever used.
  const unbracketed = trimmed.startsWith("[")
    ? trimmed.slice(1, trimmed.indexOf("]") === -1 ? undefined : trimmed.indexOf("]"))
    : trimmed
  if (isIP(unbracketed)) {
    return unbracketed
  }
  // A bare IPv4 with a port ("203.0.113.7:54321"); IPv6 without brackets is
  // ambiguous with its own colons and is left alone.
  const [host] = unbracketed.split(":")
  return host && unbracketed.split(":").length === 2 && isIP(host) ? host : null
}
