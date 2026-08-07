import { createConnection, type Socket } from "node:net"

import { NextRequest } from "next/server"

import type {
  ServiceHealthState,
  SystemHealthSnapshot,
  SystemServiceHealth,
} from "@/components/super-admin/secondary/types"
import { authenticatedBackendFetch } from "@/lib/server/auth-session"
import {
  apiErrorResponse,
  backendErrorResponse,
  requestFailureResponse,
} from "@/lib/server/responses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PROBE_TIMEOUT_MS = 3_000

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const authorization = await authorizePlatformHealthRead(request.signal)
    if (authorization) return authorization

    const checkedAt = new Date().toISOString()
    const [api, postgresql, redis, printBridge] = await Promise.all([
      probeApi(request.signal, checkedAt),
      probePostgresql(request.signal, checkedAt),
      probeRedis(request.signal, checkedAt),
      probePrintBridge(request.signal, checkedAt),
    ])

    const snapshot: SystemHealthSnapshot = {
      checkedAt,
      services: [api, postgresql, redis, printBridge],
      adapter: {
        source: "live-probes",
        limitations: [
          "PostgreSQL durumu API /ready yanıtındaki bağlantı pinginden türetilir.",
          "Redis durumu web sunucusundan gönderilen salt-okunur PING probudur.",
          "Print Bridge durumu köprünün /healthz süreç sinyalidir; bağlı yazıcıların fiziksel durumunu ölçmez.",
        ],
      },
    }

    return Response.json(snapshot, {
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    return requestFailureResponse(error)
  }
}

async function authorizePlatformHealthRead(
  signal: AbortSignal,
): Promise<Response | null> {
  const response = await authenticatedBackendFetch("auth/me", {
    headers: { accept: "application/json" },
    method: "GET",
    signal,
  })

  if (!response.ok) {
    return backendErrorResponse(response)
  }

  const body = await response.json().catch(() => null)
  const record = asRecord(body)
  const permissions = Array.isArray(record?.permissions)
    ? record.permissions.filter(
        (permission): permission is string => typeof permission === "string",
      )
    : []
  const isSuperAdmin = record?.is_super_admin === true

  if (
    !isSuperAdmin &&
    !permissions.includes("*") &&
    !permissions.includes("platform.system.read")
  ) {
    return apiErrorResponse(
      403,
      "permission_denied",
      "Sistem sağlık verilerini görüntüleme yetkiniz bulunmuyor.",
    )
  }

  return null
}

async function probeApi(
  signal: AbortSignal,
  observedAt: string,
): Promise<SystemServiceHealth> {
  const target = buildPlatformEndpoint("health")
  if (!target) {
    return unknownService(
      "api",
      "Dixora API",
      "API sağlık adresi yapılandırılmamış.",
      "GET /health",
      observedAt,
    )
  }

  const probe = await fetchProbe(target, signal)
  if (!probe.response) {
    return {
      id: "api",
      name: "Dixora API",
      state: "offline",
      summary: "API yanıt vermiyor",
      detail: probe.error ?? "Sağlık endpointine bağlantı kurulamadı.",
      latencyMs: probe.latencyMs,
      observedAt,
      endpointLabel: "GET /health",
    }
  }

  const payload = asRecord(await readJson(probe.response))
  const healthy =
    probe.response.ok &&
    (payload?.status === "ok" || payload?.status === "healthy")

  return {
    id: "api",
    name: "Dixora API",
    state: healthy ? "healthy" : "degraded",
    summary: healthy ? "API erişilebilir" : "API beklenmeyen yanıt verdi",
    detail: healthy
      ? "Uygulama liveness kontrolü başarılı."
      : `Sağlık endpointi HTTP ${probe.response.status} döndürdü.`,
    latencyMs: probe.latencyMs,
    observedAt,
    endpointLabel: "GET /health",
    metadata: {
      service:
        typeof payload?.service === "string" ? payload.service : "dixora-api",
      httpStatus: probe.response.status,
    },
  }
}

async function probePostgresql(
  signal: AbortSignal,
  observedAt: string,
): Promise<SystemServiceHealth> {
  const target = buildPlatformEndpoint("ready")
  if (!target) {
    return unknownService(
      "postgresql",
      "PostgreSQL",
      "API readiness adresi yapılandırılmamış.",
      "GET /ready",
      observedAt,
    )
  }

  const probe = await fetchProbe(target, signal)
  if (!probe.response) {
    return {
      id: "postgresql",
      name: "PostgreSQL",
      state: "offline",
      summary: "Veritabanı doğrulanamadı",
      detail: probe.error ?? "API readiness endpointine ulaşılamadı.",
      latencyMs: probe.latencyMs,
      observedAt,
      endpointLabel: "GET /ready",
    }
  }

  const payload = asRecord(await readJson(probe.response))
  const databaseReady = payload?.database === true

  return {
    id: "postgresql",
    name: "PostgreSQL",
    state: databaseReady ? "healthy" : "degraded",
    summary: databaseReady ? "Bağlantı hazır" : "Bağlantı hazır değil",
    detail: databaseReady
      ? "API veritabanı pingini başarıyla tamamladı."
      : "Readiness kontrolü veritabanı bağlantısını doğrulayamadı.",
    latencyMs: probe.latencyMs,
    observedAt,
    endpointLabel: "GET /ready",
    metadata: {
      database: databaseReady,
      httpStatus: probe.response.status,
    },
  }
}

async function probeRedis(
  signal: AbortSignal,
  observedAt: string,
): Promise<SystemServiceHealth> {
  const configured =
    process.env.DIXORA_REDIS_URL ??
    process.env.REDIS_URL ??
    (process.env.NODE_ENV === "production"
      ? "redis://redis:6379/0"
      : "redis://127.0.0.1:6379/0")

  let target: URL
  try {
    target = new URL(configured)
  } catch {
    return unknownService(
      "redis",
      "Redis",
      "Redis prob adresi geçersiz.",
      "PING Redis",
      observedAt,
    )
  }

  if (target.protocol !== "redis:") {
    return unknownService(
      "redis",
      "Redis",
      "Bu adapter yalnız redis:// PING probunu destekliyor.",
      "PING Redis",
      observedAt,
    )
  }

  const started = performance.now()
  const result = await redisPing(target, signal)
  const latencyMs = Math.max(0, Math.round(performance.now() - started))
  const endpointLabel = `PING ${target.hostname}:${target.port || "6379"}`

  if (result.ok) {
    return {
      id: "redis",
      name: "Redis",
      state: "healthy",
      summary: "PING yanıtı alındı",
      detail: "Redis bağlantısı web BFF düğümünden doğrulandı.",
      latencyMs,
      observedAt,
      endpointLabel,
    }
  }

  return {
    id: "redis",
    name: "Redis",
    state: result.reachable ? "degraded" : "offline",
    summary: result.reachable
      ? "Redis probu reddedildi"
      : "Redis yanıt vermiyor",
    detail: result.message,
    latencyMs,
    observedAt,
    endpointLabel,
  }
}

async function probePrintBridge(
  signal: AbortSignal,
  observedAt: string,
): Promise<SystemServiceHealth> {
  const configured =
    process.env.PRINT_BRIDGE_HEALTH_URL ??
    (process.env.NODE_ENV === "production"
      ? "http://print-bridge:9100/healthz"
      : "http://127.0.0.1:9100/healthz")

  let target: URL
  try {
    target = new URL(configured)
  } catch {
    return unknownService(
      "print-bridge",
      "Print Bridge",
      "Print Bridge sağlık adresi geçersiz.",
      "GET /healthz",
      observedAt,
    )
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return unknownService(
      "print-bridge",
      "Print Bridge",
      "Print Bridge probu HTTP veya HTTPS adresi gerektiriyor.",
      "GET /healthz",
      observedAt,
    )
  }

  const probe = await fetchProbe(target, signal)
  if (!probe.response) {
    return {
      id: "print-bridge",
      name: "Print Bridge",
      state: "offline",
      summary: "Köprü yanıt vermiyor",
      detail: probe.error ?? "Print Bridge sağlık endpointine ulaşılamadı.",
      latencyMs: probe.latencyMs,
      observedAt,
      endpointLabel: "GET /healthz",
    }
  }

  const payload = asRecord(await readJson(probe.response))
  const rawState =
    typeof payload?.status === "string" ? payload.status : "unknown"
  const state: ServiceHealthState =
    probe.response.ok && rawState === "ok"
      ? "healthy"
      : probe.response.ok
        ? "degraded"
        : "offline"

  return {
    id: "print-bridge",
    name: "Print Bridge",
    state,
    summary:
      state === "healthy"
        ? "Köprü çevrimiçi"
        : state === "degraded"
          ? "Köprü kısıtlı çalışıyor"
          : "Köprü hazır değil",
    detail:
      typeof payload?.lastError === "string" && payload.lastError.length > 0
        ? payload.lastError
        : state === "healthy"
          ? "İş kuyruğu yoklaması çalışan süreç tarafından doğrulandı."
          : `Köprü ${rawState} durumunu bildirdi.`,
    latencyMs: probe.latencyMs,
    observedAt,
    endpointLabel: "GET /healthz",
    metadata: {
      bridgeId:
        typeof payload?.bridgeId === "string" ? payload.bridgeId : null,
      processedJobs:
        typeof payload?.processedJobs === "number"
          ? payload.processedJobs
          : null,
      failedJobs:
        typeof payload?.failedJobs === "number" ? payload.failedJobs : null,
      lastSuccessfulPollAt:
        typeof payload?.lastSuccessfulPollAt === "string"
          ? payload.lastSuccessfulPollAt
          : null,
    },
  }
}

function buildPlatformEndpoint(path: "health" | "ready"): URL | null {
  const configured =
    process.env.BACKEND_API_URL ??
    process.env.DIXORA_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : "http://127.0.0.1:8000/api/v1/")

  if (!configured) return null

  try {
    const apiUrl = new URL(configured)
    apiUrl.username = ""
    apiUrl.password = ""
    apiUrl.search = ""
    apiUrl.hash = ""
    apiUrl.pathname = apiUrl.pathname.replace(/\/api\/v\d+\/?$/i, "/")
    if (!apiUrl.pathname.endsWith("/")) apiUrl.pathname += "/"
    return new URL(path, apiUrl)
  } catch {
    return null
  }
}

async function fetchProbe(
  target: URL,
  callerSignal: AbortSignal,
): Promise<{
  response: Response | null
  latencyMs: number
  error?: string
}> {
  const started = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const abortFromCaller = () => controller.abort(callerSignal.reason)
  callerSignal.addEventListener("abort", abortFromCaller, { once: true })

  try {
    const response = await fetch(target, {
      cache: "no-store",
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    })
    return {
      response,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
    }
  } catch (error) {
    return {
      response: null,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      error:
        error instanceof Error && error.name === "AbortError"
          ? "Sağlık probu zaman aşımına uğradı."
          : "Sağlık endpointine bağlantı kurulamadı.",
    }
  } finally {
    clearTimeout(timeout)
    callerSignal.removeEventListener("abort", abortFromCaller)
  }
}

async function redisPing(
  target: URL,
  signal: AbortSignal,
): Promise<{ ok: boolean; reachable: boolean; message: string }> {
  if (signal.aborted) {
    return {
      ok: false,
      reachable: false,
      message: "Redis probu istemci tarafından iptal edildi.",
    }
  }

  return new Promise((resolve) => {
    let socket: Socket | null = null
    let settled = false
    let received = ""

    const finish = (
      result: { ok: boolean; reachable: boolean; message: string },
    ) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", abort)
      socket?.destroy()
      resolve(result)
    }
    const abort = () =>
      finish({
        ok: false,
        reachable: false,
        message: "Redis probu istemci tarafından iptal edildi.",
      })

    signal.addEventListener("abort", abort, { once: true })
    socket = createConnection({
      host: target.hostname,
      port: Number.parseInt(target.port || "6379", 10),
    })
    socket.setEncoding("utf8")
    socket.setTimeout(PROBE_TIMEOUT_MS)

    socket.once("connect", () => {
      const username = decodeURIComponent(target.username || "default")
      const password = decodeURIComponent(target.password)
      if (password) {
        socket?.write(encodeRedisCommand(["AUTH", username, password]))
      }
      socket?.write(encodeRedisCommand(["PING"]))
    })
    socket.on("data", (chunk: string) => {
      received += chunk
      if (received.includes("+PONG")) {
        finish({
          ok: true,
          reachable: true,
          message: "Redis PING yanıtı alındı.",
        })
      } else if (received.includes("-")) {
        finish({
          ok: false,
          reachable: true,
          message:
            "Redis erişilebilir ancak kimlik doğrulama veya PING isteğini reddetti.",
        })
      }
    })
    socket.once("timeout", () =>
      finish({
        ok: false,
        reachable: false,
        message: "Redis PING probu zaman aşımına uğradı.",
      }),
    )
    socket.once("error", () =>
      finish({
        ok: false,
        reachable: false,
        message: "Redis bağlantısı kurulamadı.",
      }),
    )
    socket.once("end", () => {
      if (!settled) {
        finish({
          ok: false,
          reachable: true,
          message: "Redis bağlantısı PONG yanıtı vermeden kapandı.",
        })
      }
    })
  })
}

function encodeRedisCommand(parts: string[]): string {
  return `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join("")}`
}

function unknownService(
  id: SystemServiceHealth["id"],
  name: string,
  detail: string,
  endpointLabel: string,
  observedAt: string,
): SystemServiceHealth {
  return {
    id,
    name,
    state: "unknown",
    summary: "Prob yapılandırılmadı",
    detail,
    latencyMs: null,
    observedAt,
    endpointLabel,
  }
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}
