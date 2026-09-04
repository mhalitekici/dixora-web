import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrderActivityReport } from "@/components/reports/order-activity-report";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ORDER_ID = "11111111-2222-3333-4444-555555555555";

const feedRow = {
  order_id: ORDER_ID,
  created_at: "2026-08-08T18:30:00Z",
  branch_id: "99999999-0000-0000-0000-000000000001",
  status: "PAID",
  source: "WAITER",
  table_name: "B1",
  staff_name: "Ahmet Y.",
  member_code: null,
  delivery_channel: null,
  customer_name: null,
  total: "360.00",
};

const detail = {
  ...feedRow,
  reference: "AD-11111111",
  currency: "TRY",
  business_name: "Elixir Hotel",
  branch_name: "Merkez",
  branch_address: null,
  branch_phone: null,
  submitted_at: null,
  accepted_at: null,
  paid_at: "2026-08-08T19:10:00Z",
  subtotal: "360.00",
  discount_total: "0.00",
  tax_total: "0.00",
  paid_total: "360.00",
  remaining: "0.00",
  items: [
    {
      name: "Latte",
      quantity: "2",
      unit_price: "180.00",
      discount: "0.00",
      line_total: "360.00",
      status: "SERVED",
      note: null,
      modifiers: [],
    },
  ],
  payments: [],
};

function setup() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("auth/me")) {
        return Promise.resolve(
          jsonResponse({
            user: { id: "u1", displayName: "Ayşe K.", isSuperAdmin: false },
            permissions: ["reports.read"],
          }),
        );
      }
      if (url.includes(`reports/order-activity/${ORDER_ID}`)) {
        return Promise.resolve(jsonResponse(detail));
      }
      if (url.includes("reports/order-activity")) {
        return Promise.resolve(jsonResponse([feedRow]));
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<OrderActivityReport />, { wrapper });
}

describe("OrderActivityReport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens the order's history from the row's eye control", async () => {
    const user = userEvent.setup();
    setup();
    // The feed itself stays a summary; the detail is one click away.
    expect(await screen.findByText("Ahmet Y.")).toBeVisible();
    expect(screen.queryByText("Latte")).toBeNull();

    await user.click(
      await screen.findByRole("button", { name: /detayını aç/ }),
    );
    expect(await screen.findByText(/AD-11111111/)).toBeVisible();
    expect(screen.getByText("Latte")).toBeVisible();
  });
});
