import { ApiError } from "@/lib/api/errors"
import type {
  ApiSearchParams,
  ApiSearchValue,
  HttpMethod,
  LoginInput,
  LoginResult,
  RefreshResult,
  AuthContext,
  AccessibleBranches,
  SwitchBranchInput,
} from "@/lib/api/types"

const DEFAULT_TIMEOUT_MS = 20_000
const BACKEND_BFF_PREFIX = "/api/backend"

export interface ApiRequestOptions
  extends Omit<RequestInit, "body" | "method" | "signal"> {
  body?: unknown
  method?: HttpMethod
  search?: ApiSearchParams
  signal?: AbortSignal
  timeoutMs?: number
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  return requestJson<T>(buildBffUrl(path, options.search), options)
}

export async function apiDownload(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Blob> {
  const response = await request(
    buildBffUrl(path, options.search),
    options,
  )
  return response.blob()
}

export const api = {
  get<T>(
    path: string,
    options: Omit<ApiRequestOptions, "method" | "body"> = {},
  ): Promise<T> {
    return apiRequest<T>(path, { ...options, method: "GET" })
  },

  post<T>(
    path: string,
    body?: unknown,
    options: Omit<ApiRequestOptions, "method" | "body"> = {},
  ): Promise<T> {
    return apiRequest<T>(path, { ...options, body, method: "POST" })
  },

  put<T>(
    path: string,
    body?: unknown,
    options: Omit<ApiRequestOptions, "method" | "body"> = {},
  ): Promise<T> {
    return apiRequest<T>(path, { ...options, body, method: "PUT" })
  },

  patch<T>(
    path: string,
    body?: unknown,
    options: Omit<ApiRequestOptions, "method" | "body"> = {},
  ): Promise<T> {
    return apiRequest<T>(path, { ...options, body, method: "PATCH" })
  },

  delete<T>(
    path: string,
    options: Omit<ApiRequestOptions, "method" | "body"> = {},
  ): Promise<T> {
    return apiRequest<T>(path, { ...options, method: "DELETE" })
  },
}

export const authApi = {
  login(input: LoginInput, signal?: AbortSignal): Promise<LoginResult> {
    return requestJson<LoginResult>("/api/auth/login", {
      body: {
        business_slug: input.businessSlug?.trim() || null,
        identifier: input.identifier.trim(),
        password: input.password,
        branch_id: input.branchId || null,
        remember_me: input.rememberMe,
      },
      method: "POST",
      signal,
    })
  },

  me(signal?: AbortSignal): Promise<AuthContext> {
    return requestJson<AuthContext>("/api/auth/me", {
      method: "GET",
      signal,
    })
  },

  refresh(signal?: AbortSignal): Promise<RefreshResult> {
    return requestJson<RefreshResult>("/api/auth/refresh", {
      method: "POST",
      signal,
    })
  },

  branches(signal?: AbortSignal): Promise<AccessibleBranches> {
    return requestJson<AccessibleBranches>("/api/auth/branches", {
      method: "GET",
      signal,
    })
  },

  switchBranch(
    input: SwitchBranchInput,
    signal?: AbortSignal,
  ): Promise<AuthContext> {
    return requestJson<AuthContext>("/api/auth/switch-branch", {
      body: { branch_id: input.branchId },
      method: "POST",
      signal,
    })
  },

  async logout(signal?: AbortSignal): Promise<void> {
    await requestJson<void>("/api/auth/logout", {
      method: "POST",
      signal,
    })
  },
}

function buildBffUrl(path: string, search?: ApiSearchParams): string {
  if (/^https?:\/\//i.test(path)) {
    throw new TypeError("API paths must be relative")
  }

  const cleanPath = path
    .replace(/^\/?api\/v1\/?/, "")
    .replace(/^\/+/, "")

  if (!cleanPath || cleanPath.split("/").some(isUnsafePathSegment)) {
    throw new TypeError("A valid API path is required")
  }

  const params = createSearchParams(search)
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return `${BACKEND_BFF_PREFIX}/${cleanPath}${suffix}`
}

function isUnsafePathSegment(segment: string): boolean {
  return (
    segment === "." ||
    segment === ".." ||
    segment.includes("\\") ||
    segment.includes("\0")
  )
}

function createSearchParams(search?: ApiSearchParams): URLSearchParams {
  const params = new URLSearchParams()

  if (!search) {
    return params
  }

  for (const [key, value] of Object.entries(search)) {
    appendSearchValue(params, key, value)
  }

  return params
}

function appendSearchValue(
  params: URLSearchParams,
  key: string,
  value: ApiSearchValue,
): void {
  if (value === null || value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      params.append(key, String(item))
    }
    return
  }

  params.set(key, String(value))
}

async function requestJson<T>(
  url: string,
  options: ApiRequestOptions,
): Promise<T> {
  const response = await request(url, options)

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T
  }

  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("json")) {
    throw new ApiError({
      status: 502,
      code: "invalid_backend_response",
      message: "Sunucudan beklenmeyen bir yanıt alındı.",
    })
  }

  return (await response.json()) as T
}

async function request(
  url: string,
  {
    body,
    headers: inputHeaders,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...options
  }: ApiRequestOptions,
): Promise<Response> {
  const headers = new Headers(inputHeaders)
  const serializedBody = serializeBody(body, headers)
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  const abortFromCaller = () => controller.abort(signal?.reason)

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason)
    } else {
      signal.addEventListener("abort", abortFromCaller, { once: true })
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      body: serializedBody,
      credentials: "same-origin",
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw await ApiError.fromResponse(response)
    }

    return response
  } finally {
    globalThis.clearTimeout(timeout)
    signal?.removeEventListener("abort", abortFromCaller)
  }
}

function serializeBody(
  body: unknown,
  headers: Headers,
): BodyInit | undefined {
  if (body === undefined || body === null) {
    return undefined
  }

  if (
    typeof body === "string" ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return body as BodyInit
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }

  return JSON.stringify(body)
}
