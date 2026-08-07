import type { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"

import { invalidateProductReadModels } from "@/components/catalog/product-cache"
import { queryKeys } from "@/lib/api"

describe("invalidateProductReadModels", () => {
  it("invalidates both staff catalog and public QR menu caches", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined)
    const queryClient = { invalidateQueries } as unknown as QueryClient

    await invalidateProductReadModels(queryClient)

    expect(invalidateQueries).toHaveBeenCalledTimes(2)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.catalog.all,
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.qrMenu.all,
    })
  })
})
