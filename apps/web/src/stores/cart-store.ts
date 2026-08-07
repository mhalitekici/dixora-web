import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import type { DecimalString, UUID } from "@/lib/api/types"

export interface CartModifier {
  modifierId: UUID
  name: string
  priceDelta: DecimalString
}

export interface CartLine {
  lineId: string
  productId: UUID
  productName: string
  quantity: number
  unitPrice: DecimalString
  note: string
  modifiers: CartModifier[]
}

export type NewCartLine = Omit<CartLine, "lineId" | "quantity"> & {
  quantity?: number
}

interface CartState {
  branchId: UUID | null
  tableToken: string | null
  lines: CartLine[]
  setContext: (branchId: UUID | null, tableToken?: string | null) => void
  addLine: (line: NewCartLine) => string
  setQuantity: (lineId: string, quantity: number) => void
  setNote: (lineId: string, note: string) => void
  removeLine: (lineId: string) => void
  clear: () => void
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      branchId: null,
      tableToken: null,
      lines: [],
      setContext: (branchId, tableToken = null) =>
        set((state) => {
          const contextChanged =
            state.branchId !== branchId || state.tableToken !== tableToken
          return {
            branchId,
            tableToken,
            lines: contextChanged ? [] : state.lines,
          }
        }),
      addLine: (line) => {
        const lineId = globalThis.crypto.randomUUID()
        set((state) => ({
          lines: [
            ...state.lines,
            {
              ...line,
              lineId,
              note: line.note.trim().slice(0, 500),
              quantity: normalizeQuantity(line.quantity ?? 1),
            },
          ],
        }))
        return lineId
      },
      setQuantity: (lineId, quantity) =>
        set((state) => ({
          lines:
            quantity <= 0
              ? state.lines.filter((line) => line.lineId !== lineId)
              : state.lines.map((line) =>
                  line.lineId === lineId
                    ? { ...line, quantity: normalizeQuantity(quantity) }
                    : line,
                ),
        })),
      setNote: (lineId, note) =>
        set((state) => ({
          lines: state.lines.map((line) =>
            line.lineId === lineId
              ? { ...line, note: note.trim().slice(0, 500) }
              : line,
          ),
        })),
      removeLine: (lineId) =>
        set((state) => ({
          lines: state.lines.filter((line) => line.lineId !== lineId),
        })),
      clear: () =>
        set({
          branchId: null,
          tableToken: null,
          lines: [],
        }),
    }),
    {
      name: "dixora-cart",
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
    },
  ),
)

export const selectCartItemCount = (state: CartState): number =>
  state.lines.reduce((total, line) => total + line.quantity, 0)

function normalizeQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) {
    return 1
  }
  return Math.min(99, Math.max(1, Math.floor(quantity)))
}
