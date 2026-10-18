import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Megaphone, Printer } from "lucide-react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NavigationSearch } from "./navigation-search"

const push = vi.hoisted(() => vi.fn())
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

describe("navigation search", () => {
  afterEach(() => {
    push.mockClear()
    vi.unstubAllGlobals()
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView
  })
  it("opens from Ctrl+K and navigates to a permitted screen with Enter", async () => {
    const user = userEvent.setup({ delay: null })
    // JSDOM does not implement the browser layout APIs used by cmdk.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    HTMLElement.prototype.scrollIntoView = vi.fn()
    render(
      <NavigationSearch
        navigation={[
          {
            label: "Kullanılabilir ekranlar",
            items: [
              {
                label: "Kampanyalar",
                href: "/admin/campaigns",
                icon: Megaphone,
              },
              { label: "Yazıcılar", href: "/admin/printers", icon: Printer },
            ],
          },
        ]}
      />,
    )
    await user.keyboard("{Control>}k{/Control}")
    const search = await screen.findByRole("combobox")
    await user.type(search, "yazıcı")
    expect(
      screen.queryByRole("option", { name: "Kampanyalar" }),
    ).not.toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(push).toHaveBeenCalledWith("/admin/printers")
  })
})
