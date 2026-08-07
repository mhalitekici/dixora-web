import { NextRequest } from "next/server"

import { clearLoyaltyToken } from "@/lib/server/loyalty-cookie"
import { mutationOriginError } from "@/lib/server/request-security"

export async function POST(request: NextRequest): Promise<Response> {
  const originError = mutationOriginError(request)
  if (originError) return originError
  await clearLoyaltyToken()
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  })
}
