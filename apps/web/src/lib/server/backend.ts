import "server-only"

const DEFAULT_BACKEND_API_URL = "http://127.0.0.1:8000/api/v1/"
const DEFAULT_TIMEOUT_MS = 20_000

export class BackendRequestError extends Error {
  readonly kind: "configuration" | "timeout" | "network"

  constructor(
    kind: BackendRequestError["kind"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "BackendRequestError"
    this.kind = kind
  }
}

export function buildBackendUrl(
  path: string,
  search?: URLSearchParams,
): URL {
  const baseUrl = getBackendApiUrl()
  const cleanPath = path.replace(/^\/+/, "")

  if (!cleanPath || cleanPath.split("/").some(isUnsafeSegment)) {
    throw new BackendRequestError(
      "configuration",
      "An invalid backend path was requested",
    )
  }

  const url = new URL(
    cleanPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/"),
    ensureTrailingSlash(baseUrl),
  )

  if (search) {
    url.search = search.toString()
  }

  return url
}

export async function backendFetch(
  path: string,
  init: RequestInit = {},
  search?: URLSearchParams,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutMs = readPositiveInteger(
    process.env.BACKEND_REQUEST_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  )
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const callerSignal = init.signal
  const abortFromCaller = () => controller.abort(callerSignal?.reason)

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason)
    } else {
      callerSignal.addEventListener("abort", abortFromCaller, { once: true })
    }
  }

  try {
    return await fetch(buildBackendUrl(path, search), {
      ...init,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new BackendRequestError(
        "timeout",
        "The backend request timed out",
        { cause: error },
      )
    }

    throw new BackendRequestError(
      "network",
      "The backend request failed",
      { cause: error },
    )
  } finally {
    clearTimeout(timeout)
    callerSignal?.removeEventListener("abort", abortFromCaller)
  }
}

function getBackendApiUrl(): URL {
  const configured =
    process.env.BACKEND_API_URL ??
    process.env.DIXORA_API_URL ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : DEFAULT_BACKEND_API_URL)

  if (!configured) {
    throw new BackendRequestError(
      "configuration",
      "BACKEND_API_URL is required in production",
    )
  }

  let url: URL
  try {
    url = new URL(configured)
  } catch (error) {
    throw new BackendRequestError(
      "configuration",
      "BACKEND_API_URL must be a valid absolute URL",
      { cause: error },
    )
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new BackendRequestError(
      "configuration",
      "BACKEND_API_URL must use HTTP or HTTPS",
    )
  }

  url.username = ""
  url.password = ""
  url.search = ""
  url.hash = ""

  if (url.pathname === "/") {
    url.pathname = "/api/v1/"
  }

  return url
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url)
  if (!copy.pathname.endsWith("/")) {
    copy.pathname += "/"
  }
  return copy
}

function isUnsafeSegment(segment: string): boolean {
  return (
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("\0")
  )
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
