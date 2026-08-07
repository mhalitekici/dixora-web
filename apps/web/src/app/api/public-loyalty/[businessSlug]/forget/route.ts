import { NextRequest } from "next/server"

import { clearLoyaltyToken } from "@/lib/server/loyalty-cookie"
import { mutationOriginError } from "@/lib/server/request-security"

interface Context {
  params: Promise<{ businessSlug: string }>
}

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  const originError = mutationOriginError(request)
  if (originError) return originError
  const { businessSlug } = await context.params
  await clearLoyaltyToken(businessSlug)
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  })
}
