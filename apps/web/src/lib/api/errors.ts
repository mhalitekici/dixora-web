import type { ApiErrorPayload } from "@/lib/api/types"

const STATUS_CODES: Readonly<Record<number, string>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "validation_error",
  429: "rate_limited",
  500: "internal_error",
  502: "backend_unavailable",
  503: "service_unavailable",
  504: "backend_timeout",
}

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  400: "İstek işlenemedi.",
  401: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın.",
  403: "Bu işlem için yetkiniz bulunmuyor.",
  404: "İstenen kayıt bulunamadı.",
  405: "Bu işlem desteklenmiyor.",
  409: "İşlem mevcut verilerle çakışıyor.",
  413: "Gönderilen veri izin verilen boyutu aşıyor.",
  415: "Gönderilen veri biçimi desteklenmiyor.",
  422: "Lütfen girdiğiniz bilgileri kontrol edin.",
  429: "Çok fazla istek gönderildi. Lütfen biraz bekleyin.",
  500: "Beklenmeyen bir hata oluştu.",
  502: "Sunucuya şu anda ulaşılamıyor.",
  503: "Hizmet geçici olarak kullanılamıyor.",
  504: "Sunucu zamanında yanıt vermedi.",
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  readonly requestId?: string
  readonly retryAfter?: number

  constructor({
    status,
    code,
    message,
    details,
    requestId,
    retryAfter,
  }: {
    status: number
    code: string
    message: string
    details?: unknown
    requestId?: string
    retryAfter?: number
  }) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
    this.retryAfter = retryAfter
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    const payload = await readErrorPayload(response)
    const retryAfterHeader = response.headers.get("retry-after")
    const retryAfter = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10)
      : undefined

    return new ApiError({
      status: response.status,
      code: payload.error.code,
      message: payload.error.message,
      details: payload.error.details,
      requestId: payload.requestId,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
    })
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function defaultErrorCode(status: number): string {
  return STATUS_CODES[status] ?? "request_failed"
}

export function defaultErrorMessage(status: number): string {
  return STATUS_MESSAGES[status] ?? "İstek tamamlanamadı."
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "İstek zaman aşımına uğradı."
  }

  return "Beklenmeyen bir hata oluştu."
}

async function readErrorPayload(response: Response): Promise<ApiErrorPayload> {
  let body: unknown

  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  return normalizeErrorPayload(body, response.status)
}

export function normalizeErrorPayload(
  body: unknown,
  status: number,
  fallbackRequestId?: string,
): ApiErrorPayload {
  const record = asRecord(body)
  const nestedError = asRecord(record?.error)
  const detail = record?.detail

  const message =
    readString(nestedError?.message) ??
    readString(record?.message) ??
    (typeof detail === "string" ? detail : undefined) ??
    defaultErrorMessage(status)

  const code =
    readString(nestedError?.code) ??
    readString(record?.code) ??
    defaultErrorCode(status)

  const details =
    nestedError?.details ??
    record?.details ??
    (typeof detail === "string" ? undefined : detail)

  const requestId =
    readString(record?.requestId) ??
    readString(record?.request_id) ??
    fallbackRequestId

  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    ...(requestId ? { requestId } : {}),
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
