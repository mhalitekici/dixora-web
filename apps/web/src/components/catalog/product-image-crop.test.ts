import { describe, expect, it } from "vitest"

import { calculateCropPlacement } from "@/components/catalog/product-image-crop"

describe("calculateCropPlacement", () => {
  it("covers a square crop without stretching a landscape image", () => {
    const placement = calculateCropPlacement({
      sourceHeight: 1000,
      sourceWidth: 2000,
      targetHeight: 1200,
      targetWidth: 1200,
      zoom: 1,
      position: { x: 0, y: 0 },
    })

    expect(placement.drawWidth).toBe(2400)
    expect(placement.drawHeight).toBe(1200)
    expect(placement.left).toBe(-600)
    expect(placement.top).toBe(0)
  })

  it("keeps panning inside the image boundaries", () => {
    const placement = calculateCropPlacement({
      sourceHeight: 1000,
      sourceWidth: 2000,
      targetHeight: 1000,
      targetWidth: 1000,
      zoom: 1,
      position: { x: 9, y: -9 },
    })

    expect(placement.left).toBe(0)
    expect(placement.top).toBe(0)
  })

  it("applies zoom while preserving a centered crop", () => {
    const placement = calculateCropPlacement({
      sourceHeight: 1000,
      sourceWidth: 1000,
      targetHeight: 1000,
      targetWidth: 1000,
      zoom: 2,
      position: { x: 0, y: 0 },
    })

    expect(placement.drawWidth).toBe(2000)
    expect(placement.drawHeight).toBe(2000)
    expect(placement.left).toBe(-500)
    expect(placement.top).toBe(-500)
  })
})
