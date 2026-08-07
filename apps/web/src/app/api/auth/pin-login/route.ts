import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { normalizeLoginResult } from "@/lib/api/normalizers";
import {
  clearTrustedDeviceCookie,
  setAuthCookies,
  TRUSTED_DEVICE_COOKIE,
} from "@/lib/server/auth-cookies";
import { parseAuthTokens } from "@/lib/server/auth-session";
import { backendFetch } from "@/lib/server/backend";
import { mutationOriginError } from "@/lib/server/request-security";
import {
  apiErrorResponse,
  backendErrorResponse,
  requestFailureResponse,
} from "@/lib/server/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const schema = z.object({
  business_slug: z.string().trim().min(2).max(100),
  branch_slug: z.string().trim().min(2).max(100),
  username: z.string().trim().min(2).max(255),
  pin: z.string().regex(/^\d{4,12}$/),
});

export async function POST(request: NextRequest): Promise<Response> {
  const originError = mutationOriginError(request);
  if (originError) return originError;

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return apiErrorResponse(413, "payload_too_large", "PIN isteği izin verilen boyutu aşıyor.");
  }

  let input: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return apiErrorResponse(413, "payload_too_large", "PIN isteği izin verilen boyutu aşıyor.");
    }
    input = JSON.parse(body);
  } catch {
    return apiErrorResponse(400, "invalid_json", "Geçerli bir JSON gövdesi gönderin.");
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return apiErrorResponse(
      422,
      "validation_error",
      "PIN giriş bilgilerini kontrol edin.",
      parsed.error.flatten(),
    );
  }

  try {
    const deviceToken = request.cookies.get(TRUSTED_DEVICE_COOKIE)?.value ?? null;
    const response = await backendFetch("auth/pin-login", {
      method: "POST",
      body: JSON.stringify({
        ...parsed.data,
        device_token: deviceToken,
      }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": request.headers.get("user-agent") ?? "Dixora Web BFF",
        "x-request-id": request.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
      signal: request.signal,
    });

    if (!response.ok) {
      const outgoing = await backendErrorResponse(response);
      if (response.status === 403) {
        await clearTrustedDeviceCookie();
      }
      return outgoing;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return apiErrorResponse(
        502,
        "invalid_auth_response",
        "Kimlik sunucusundan geçersiz yanıt alındı.",
      );
    }

    const tokens = parseAuthTokens(body);
    const result = normalizeLoginResult(body);
    if (!tokens || !result) {
      return apiErrorResponse(
        502,
        "invalid_auth_response",
        "Kimlik sunucusundan geçersiz yanıt alındı.",
      );
    }

    await setAuthCookies(tokens);
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return requestFailureResponse(error);
  }
}
