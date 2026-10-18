import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"

describe("readable select values", () => {
  it("shows the selected label before the menu is opened", () => {
    render(
      <Select value="FREE_ITEM">
        <SelectTrigger aria-label="Ödül">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="FREE_ITEM">Ürün ikram</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(screen.getByRole("combobox", { name: "Ödül" })).toHaveTextContent(
      "Ürün ikram",
    )
    expect(screen.queryByText("FREE_ITEM")).not.toBeInTheDocument()
  })

  it("resolves asynchronously loaded UUID options while the menu stays closed", async () => {
    const id = "11111111-1111-1111-1111-111111111111"
    const view = (loaded: boolean) => (
      <Select value={id}>
        <SelectTrigger aria-label="Şube">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {loaded ? <SelectItem value={id}>Kadıköy</SelectItem> : null}
        </SelectContent>
      </Select>
    )
    const { rerender } = render(view(false))
    rerender(view(true))
    expect(screen.getByRole("combobox", { name: "Şube" })).toHaveTextContent(
      "Kadıköy",
    )
    const user = userEvent.setup({ delay: null })
    await user.click(screen.getByRole("combobox", { name: "Şube" }))
    expect(await screen.findByRole("option", { name: "Kadıköy" })).toBeVisible()
  })

  it("preserves explicitly supplied option labels", () => {
    render(
      <Select value="cash" items={{ cash: "Nakit tahsilat" }}>
        <SelectTrigger aria-label="Ödeme">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="cash">Nakit</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(screen.getByRole("combobox", { name: "Ödeme" })).toHaveTextContent(
      "Nakit tahsilat",
    )
  })
})
