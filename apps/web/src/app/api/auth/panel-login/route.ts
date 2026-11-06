import { NextRequest } from "next/server";
import { z } from "zod";
import { normalizeLoginResult } from "@/lib/api/normalizers";
import { setAuthCookies } from "@/lib/server/auth-cookies";
import {
  authenticatedBackendFetch,
  parseAuthTokens,
} from "@/lib/server/auth-session";
import { clientAddressHeaders } from "@/lib/server/client-address";
import { mutationOriginError } from "@/lib/server/request-security";
import {
  apiErrorResponse,
  backendErrorResponse,
  requestFailureResponse,
} from "@/lib/server/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z
  .object({
    username: z.string().trim().min(1).max(255),
    pin: z.string().regex(/^[0-9]{4,12}$/),
  })
  .strict();

export async function POST(request: NextRequest): Promise<Response> {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 4096)
      return apiErrorResponse(413, "payload_too_large", "İstek çok büyük.");
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return apiErrorResponse(
        400,
        "invalid_json",
        "Geçerli bir istek gönderin.",
      );
    }
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      return apiErrorResponse(
        422,
        "validation_error",
        "Kullanıcı adı ve 4–12 haneli PIN girin.",
      );
    const response = await authenticatedBackendFetch("auth/panel-login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...clientAddressHeaders(request),
      },
      body: JSON.stringify(parsed.data),
      signal: request.signal,
    });
    if (!response.ok) return backendErrorResponse(response);
    const payload: unknown = await response.json();
    const tokens = parseAuthTokens(payload);
    const result = normalizeLoginResult(payload);
    if (!tokens || !result)
      return apiErrorResponse(
        502,
        "invalid_auth_response",
        "Giriş yanıtı doğrulanamadı.",
      );
    await setAuthCookies(tokens);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return requestFailureResponse(error);
  }
}
