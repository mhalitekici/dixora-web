import type { QueryClient } from "@tanstack/react-query"

import { queryKeys } from "@/lib/api"

export async function invalidateProductReadModels(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.qrMenu.all }),
  ])
}
