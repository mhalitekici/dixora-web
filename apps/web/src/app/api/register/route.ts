import { NextRequest } from "next/server";
import { z } from "zod";

import { backendFetch } from "@/lib/server/backend";
import { clientAddressHeaders } from "@/lib/server/client-address";
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
  business_name: z.string().trim().min(2).max(140),
  business_type: z.enum(["RESTAURANT", "CAFE", "BAR", "HOTEL"]),
  owner_name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(255),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+()\s.-]{7,32}$/, "Geçerli bir telefon numarası girin."),
  password: z.string().min(10).max(256),
  terms_accepted: z.literal(true),
  contract_version: z.string().trim().min(1).max(40).default("unknown"),
  privacy_notice_acknowledged: z.literal(true),
  privacy_notice_version: z.string().trim().min(1).max(40).default("unknown"),
  marketing_consent: z.boolean().default(false),
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
      "Kayıt bilgilerini kontrol edin.",
      parsed.error.flatten(),
    );
  }

  try {
    const response = await backendFetch("registrations/start", {
      body: JSON.stringify(parsed.data),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": request.headers.get("user-agent") ?? "Dixora Web BFF",
        ...clientAddressHeaders(request),
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
