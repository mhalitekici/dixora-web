import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
}))

vi.mock("@/lib/api/client", () => ({
  authApi: {
    logout: mocks.logout,
  },
}))

import { useLogout } from "@/hooks/use-auth"

describe("useLogout", () => {
  it("lets a hard-navigation callback run without clearing the mounted page cache", async () => {
    mocks.logout.mockResolvedValue(undefined)
    const queryClient = new QueryClient()
    const clear = vi.spyOn(queryClient, "clear")
    const onSettled = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useLogout({ onSettled }), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
    expect(clear).not.toHaveBeenCalled()
  })
})
