import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { DeleteBusinessDialog } from "@/components/super-admin/secondary/business-detail"

const business = { name: "Aleyin Mutfağı", slug: "aleyin-mutfagi" }

function open(overrides: Partial<Parameters<typeof DeleteBusinessDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const props = {
    business,
    open: true,
    confirmation: "",
    reason: "",
    pending: false,
    onConfirmationChange: vi.fn(),
    onReasonChange: vi.fn(),
    onOpenChange: vi.fn(),
    onConfirm,
    ...overrides,
  }
  render(<DeleteBusinessDialog {...props} />)
  return { onConfirm, props }
}

function confirmButton() {
  return screen.getByRole("button", { name: /kalıcı olarak sil/i })
}

describe("DeleteBusinessDialog", () => {
  it("says plainly that the deletion cannot be undone", () => {
    open()
    expect(
      screen.getByText(/Bu işlem geri alınamaz/i),
    ).toBeInTheDocument()
  })

  it("keeps the delete button disabled until the name is typed", () => {
    open({ confirmation: "" })
    expect(confirmButton()).toBeDisabled()
  })

  it("rejects a near-miss, including different casing", () => {
    open({ confirmation: "aleyin mutfağı" })
    expect(confirmButton()).toBeDisabled()
  })

  it("enables only on an exact match, ignoring stray whitespace", () => {
    open({ confirmation: "  Aleyin Mutfağı  " })
    expect(confirmButton()).toBeEnabled()
  })

  it("confirms once when pressed", async () => {
    const user = userEvent.setup()
    const { onConfirm } = open({ confirmation: business.name })
    await user.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("cannot be submitted twice while the request is in flight", async () => {
    const user = userEvent.setup()
    const { onConfirm } = open({ confirmation: business.name, pending: true })

    const button = screen.getByRole("button", { name: /siliniyor/i })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("shows the exact name the operator has to reproduce", () => {
    open()
    expect(screen.getAllByText(business.name).length).toBeGreaterThan(0)
  })
})
