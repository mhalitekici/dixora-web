import { NextRequest } from "next/server";
import { z } from "zod";

import { backendFetch } from "@/lib/server/backend";
import { mutationOriginError } from "@/lib/server/request-security";
import {
  apiErrorResponse,
  backendErrorResponse,
  requestFailureResponse,
} from "@/lib/server/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REGISTRATION_BODY_BYTES = 32 * 1024;

const registrationSchema = z.object({
  verification_id: z.string().uuid(),
  code: z.string().trim().min(4).max(12),
});

export async function POST(request: NextRequest): Promise<Response> {
  const originError = mutationOriginError(request);
  if (originError) return originError;

  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "0",
    10,
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REGISTRATION_BODY_BYTES
  ) {
    return apiErrorResponse(
      413,
      "payload_too_large",
      "Kayıt isteği izin verilen boyutu aşıyor.",
    );
  }

  let input: unknown;
  try {
    const rawBody = await request.text();
    if (
      new TextEncoder().encode(rawBody).byteLength >
      MAX_REGISTRATION_BODY_BYTES
    ) {
      return apiErrorResponse(
        413,
        "payload_too_large",
        "Kayıt isteği izin verilen boyutu aşıyor.",
      );
    }
    input = JSON.parse(rawBody);
  } catch {
    return apiErrorResponse(
      400,
      "invalid_json",
      "Geçerli bir JSON gövdesi gönderin.",
    );
  }

  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) {
    return apiErrorResponse(
      422,
      "validation_error",
      "Doğrulama kodunu kontrol edin.",
      parsed.error.flatten(),
    );
  }

  try {
    const response = await backendFetch("registrations/confirm", {
      body: JSON.stringify(parsed.data),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": request.headers.get("user-agent") ?? "Dixora Web BFF",
        "x-forwarded-for":
          request.headers.get("x-forwarded-for") ??
          request.headers.get("x-real-ip") ??
          "",
        "x-request-id":
          request.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
      method: "POST",
      signal: request.signal,
    });

    if (!response.ok) return backendErrorResponse(response);

    const body = (await response.json().catch(() => null)) as unknown;
    if (!body) {
      return apiErrorResponse(
        502,
        "invalid_registration_response",
        "Kayıt sunucusundan geçersiz yanıt alındı.",
      );
    }

    return Response.json(body, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return requestFailureResponse(error);
  }
}
