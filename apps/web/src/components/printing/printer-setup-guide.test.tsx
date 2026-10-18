import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PrinterSetupGuide } from "./printer-setup-guide"
import type { PrintBridge } from "@/components/admin/types"

describe("printer setup guidance", () => {
  it("does not mark installation complete for a code that has never connected", () => {
    render(
      <PrinterSetupGuide
        bridges={[
          {
            id: "new-computer",
            is_active: true,
            is_online: false,
            last_seen_at: null,
            printer_mappings: [],
          } as unknown as PrintBridge,
        ]}
        devices={[]}
        jobs={[]}
        apiUrl="https://api.example.com"
        onConnect={vi.fn()}
        onAddPrinter={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getAllByText("Bekleniyor")).toHaveLength(4)
    expect(screen.queryByText("Tamamlandı")).not.toBeInTheDocument()
  })
  it("guides an unconfigured branch and identifies the missing cashier route", () => {
    render(
      <PrinterSetupGuide
        bridges={[]}
        devices={[]}
        jobs={[]}
        apiUrl="https://api.example.com"
        onConnect={vi.fn()}
        onAddPrinter={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getAllByText("Bekleniyor")).toHaveLength(4)
    expect(screen.getByText(/Hesap fişi için/)).toBeVisible()
    expect(
      screen.getByRole("button", { name: "API adresini kopyala" }),
    ).toBeVisible()
    expect(screen.getByText("https://api.example.com")).toBeVisible()
  })
})
