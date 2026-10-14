import { beforeEach, describe, expect, it } from "vitest"

import {
  selectCartItemCount,
  useCartStore,
  type NewCartLine,
} from "@/stores/cart-store"
import { cartLineTotalMinor, cartTotalMinor } from "@/components/qr/qr-utils"

const baseLine: NewCartLine = {
  productId: "product-1",
  productName: "Izgara Levrek",
  unitPrice: "420.00",
  note: "",
  modifiers: [
    {
      modifierId: "modifier-1",
      name: "Ekstra limon",
      priceDelta: "10.00",
    },
  ],
}

describe("cart store", () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    useCartStore.persist.clearStorage()
    useCartStore.setState({
      branchId: null,
      tableToken: null,
      lines: [],
    })
  })

  it("adds a normalized line and updates its quantity and note", () => {
    const lineId = useCartStore.getState().addLine({
      ...baseLine,
      note: "  Az pişmiş  ",
      quantity: 120,
    })

    expect(lineId).toEqual(expect.any(String))
    expect(useCartStore.getState().lines).toEqual([
      expect.objectContaining({
        lineId,
        note: "Az pişmiş",
        quantity: 99,
      }),
    ])

    useCartStore.getState().setQuantity(lineId, 2.9)
    useCartStore.getState().setNote(lineId, `  ${"a".repeat(510)}  `)

    const state = useCartStore.getState()
    expect(state.lines[0]).toMatchObject({
      lineId,
      quantity: 2,
    })
    expect(state.lines[0]?.note).toHaveLength(500)
    expect(selectCartItemCount(state)).toBe(2)
  })

  it("removes lines explicitly and when quantity reaches zero", () => {
    const firstId = useCartStore.getState().addLine(baseLine)
    const secondId = useCartStore.getState().addLine({
      ...baseLine,
      productId: "product-2",
      productName: "Mevsim Salata",
      modifiers: [],
    })

    useCartStore.getState().removeLine(firstId)
    expect(useCartStore.getState().lines.map((line) => line.lineId)).toEqual([
      secondId,
    ])

    useCartStore.getState().setQuantity(secondId, 0)
    expect(useCartStore.getState().lines).toHaveLength(0)
  })

  it("counts whole products and includes modifiers in the full price", () => {
    const lineId = useCartStore.getState().addLine({
      ...baseLine,
      quantity: 2,
    })
    let state = useCartStore.getState()
    expect(state.lines[0].quantity).toBe(2)
    expect(cartLineTotalMinor(state.lines[0])).toBe(BigInt(86000))
    expect(selectCartItemCount(state)).toBe(2)
    useCartStore.getState().setQuantity(lineId, 1)
    state = useCartStore.getState()
    expect(selectCartItemCount(state)).toBe(1)
    expect(cartTotalMinor(state.lines)).toBe(BigInt(43000))
    useCartStore.getState().setQuantity(lineId, 0)
    expect(useCartStore.getState().lines).toHaveLength(0)
  })

  it("rehydrates full products and drops obsolete portion drafts without repricing them", async () => {
    window.sessionStorage.setItem(
      "dixora-cart",
      JSON.stringify({
        version: 1,
        state: {
          branchId: "branch-a",
          tableToken: "table-a",
          lines: [
            { ...baseLine, lineId: "full", quantity: 2, portionSize: 1 },
            {
              ...baseLine,
              lineId: "fractional",
              quantity: 0.5,
              portionSize: 0.5,
            },
            {
              ...baseLine,
              lineId: "two-halves",
              quantity: 1,
              portionSize: 0.5,
            },
          ],
        },
      }),
    )
    await useCartStore.persist.rehydrate()
    const state = useCartStore.getState()
    expect(state).toMatchObject({
      branchId: "branch-a",
      tableToken: "table-a",
    })
    expect(state.lines).toEqual([{ ...baseLine, lineId: "full", quantity: 2 }])
    expect(cartTotalMinor(state.lines)).toBe(BigInt(86000))
    expect(selectCartItemCount(state)).toBe(2)
  })

  it("retains a cart in the same context and resets it on table or branch changes", () => {
    useCartStore.getState().setContext("branch-a", "table-a")
    useCartStore.getState().addLine(baseLine)

    useCartStore.getState().setContext("branch-a", "table-a")
    expect(useCartStore.getState().lines).toHaveLength(1)

    useCartStore.getState().setContext("branch-a", "table-b")
    expect(useCartStore.getState()).toMatchObject({
      branchId: "branch-a",
      tableToken: "table-b",
      lines: [],
    })

    useCartStore.getState().addLine(baseLine)
    useCartStore.getState().setContext("branch-b", "table-b")
    expect(useCartStore.getState()).toMatchObject({
      branchId: "branch-b",
      tableToken: "table-b",
      lines: [],
    })
  })
})
