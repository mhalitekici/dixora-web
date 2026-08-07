import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StampProgress } from "./stamp-progress"

describe("StampProgress", () => {
  it("exposes the exact progress to assistive technologies", () => {
    render(<StampProgress value={3} target={5} />)

    expect(screen.getByRole("progressbar", { name: "Ödül ilerlemesi" })).toHaveAttribute(
      "aria-valuetext",
      "3 / 5",
    )
  })

  it("normalizes invalid boundaries", () => {
    const { rerender } = render(<StampProgress value={-2} target={0} />)
    const progress = screen.getByRole("progressbar")

    expect(progress).toHaveAttribute("aria-valuemin", "0")
    expect(progress).toHaveAttribute("aria-valuemax", "1")
    expect(progress).toHaveAttribute("aria-valuenow", "0")

    rerender(<StampProgress value={12} target={5} />)
    expect(progress).toHaveAttribute("aria-valuenow", "5")
  })
})
