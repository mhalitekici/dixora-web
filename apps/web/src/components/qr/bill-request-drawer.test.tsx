import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BillRequestDrawer } from "@/components/qr/bill-request-drawer";

describe("BillRequestDrawer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the bill preview readable and marks complimentary lines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ enabled: false }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    render(
      <BillRequestDrawer
        open
        onOpenChange={vi.fn()}
        businessSlug="dodo"
        branchSlug="merkez"
        total="₺550,00"
        submitting={false}
        onSubmit={vi.fn(async () => undefined)}
        order={{
          status: "SERVED",
          currency: "TRY",
          table_name: "Salon 3",
          items: [
            {
              id: "item-1",
              product_name_snapshot: "Kahve",
              quantity: "1",
              unit_price: "100.00",
              line_total: "0.00",
              is_complimentary: true,
              complimentary_reason: "Müşteri memnuniyeti",
              status: "ACCEPTED",
              note: null,
            },
          ],
          subtotal: "500.00",
          discount_total: "0.00",
          tax_total: "0.00",
          service_charge_type: "PERCENTAGE",
          service_charge_value: "10.00",
          service_charge_amount: "50.00",
          total: "550.00",
          paid_total: "0.00",
          remaining: "550.00",
        }}
      />,
      { wrapper },
    );

    expect(await screen.findByText("Kahve")).toBeVisible();
    expect(screen.getByText("İKRAM")).toBeVisible();
    expect(screen.getByText("Ara toplam")).toBeVisible();
    expect(screen.getByText("Servis")).toBeVisible();
    expect(screen.getByText("Toplam")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Hesap talebini garsona gönder" }),
    ).toBeEnabled();
  });
});
