import { NextRequest } from "next/server"
import { z } from "zod"

import { normalizeLoginResult } from "@/lib/api/normalizers"
import {
  clearTrustedDeviceCookie,
  setAuthCookies,
  setTrustedDeviceCookie,
  TRUSTED_DEVICE_COOKIE,
  type TrustedDeviceCredential,
} from "@/lib/server/auth-cookies"
import { parseAuthTokens } from "@/lib/server/auth-session"
import { backendFetch } from "@/lib/server/backend"
import { mutationOriginError } from "@/lib/server/request-security"
import {
  apiErrorResponse,
  backendErrorResponse,
  requestFailureResponse,
} from "@/lib/server/responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_LOGIN_BODY_BYTES = 32 * 1024

const loginSchema = z.object({
  business_slug: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional()
    .transform((value) => value || null),
  identifier: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(1024),
  branch_id: z.string().uuid().nullable().optional(),
  remember_me: z.boolean().default(false),
})

export async function POST(request: NextRequest): Promise<Response> {
  const originError = mutationOriginError(request)
  if (originError) {
    return originError
  }

  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "0",
    10,
  )
  if (Number.isFinite(contentLength) && contentLength > MAX_LOGIN_BODY_BYTES) {
    return apiErrorResponse(
      413,
      "payload_too_large",
      "Giriş isteği izin verilen boyutu aşıyor.",
    )
  }

  let input: unknown
  try {
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_LOGIN_BODY_BYTES) {
      return apiErrorResponse(
        413,
        "payload_too_large",
        "Giriş isteği izin verilen boyutu aşıyor.",
      )
    }
    input = JSON.parse(rawBody)
  } catch {
    return apiErrorResponse(
      400,
      "invalid_json",
      "Geçerli bir JSON gövdesi gönderin.",
    )
  }

  const parsed = loginSchema.safeParse(input)
  if (!parsed.success) {
    return apiErrorResponse(
      422,
      "validation_error",
      "Giriş bilgilerini kontrol edin.",
      parsed.error.flatten(),
    )
  }

  try {
    const existingTrustedDevice = request.cookies.get(
      TRUSTED_DEVICE_COOKIE,
    )?.value
    const backendPayload = {
      business: parsed.data.business_slug,
      username: parsed.data.identifier,
      password: parsed.data.password,
      branch_id: parsed.data.branch_id ?? null,
      remember_me: parsed.data.remember_me,
      enroll_trusted_device: parsed.data.business_slug !== null,
      trusted_device_token:
        existingTrustedDevice && existingTrustedDevice.length <= 200
          ? existingTrustedDevice
          : null,
    }
    const response = await backendFetch("auth/login", {
      body: JSON.stringify(backendPayload),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": request.headers.get("user-agent") ?? "Dixora Web BFF",
        "x-request-id":
          request.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
      method: "POST",
      signal: request.signal,
    })

    if (!response.ok) {
      return backendErrorResponse(response)
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return apiErrorResponse(
        502,
        "invalid_auth_response",
        "Kimlik sunucusundan geçersiz yanıt alındı.",
      )
    }

    const tokens = parseAuthTokens(body)
    const result = normalizeLoginResult(body)
    if (!tokens || !result) {
      return apiErrorResponse(
        502,
        "invalid_auth_response",
        "Kimlik sunucusundan geçersiz yanıt alındı.",
      )
    }

    await setAuthCookies(tokens)
    if (parsed.data.business_slug !== null) {
      const trustedDevice = parseTrustedDeviceCredential(body)
      if (trustedDevice) {
        await setTrustedDeviceCookie(trustedDevice)
      } else {
        await clearTrustedDeviceCookie()
      }
    }
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    return requestFailureResponse(error)
  }
}

function parseTrustedDeviceCredential(
  value: unknown,
): TrustedDeviceCredential | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  const trustedDevice = (value as Record<string, unknown>).trusted_device
  if (
    typeof trustedDevice !== "object" ||
    trustedDevice === null ||
    Array.isArray(trustedDevice)
  ) {
    return null
  }
  const record = trustedDevice as Record<string, unknown>
  const token = record.token
  const expiresIn = record.expires_in
  if (
    typeof token !== "string" ||
    token.length < 32 ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    return null
  }
  return { token, expiresIn: Math.floor(expiresIn) }
}
