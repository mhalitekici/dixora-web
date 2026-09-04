import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeliveryInbox } from "@/components/delivery/delivery-inbox";
import { elapsedMinutes, urgency } from "@/components/delivery/delivery-api";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const order = {
  id: "11111111-1111-1111-1111-111111111111",
  order_id: "22222222-2222-2222-2222-222222222222",
  branch_id: "33333333-3333-3333-3333-333333333333",
  channel: "PHONE",
  provider: null,
  delivery_status: "NEW",
  sync_status: "NOT_APPLICABLE",
  sync_error: null,
  external_display_id: null,
  customer_name: "Ahmet Y.",
  customer_phone: "0555 111 22 33",
  address_line: null,
  district: null,
  neighbourhood: null,
  address_note: null,
  customer_note: "Soğansız, zil çalışmıyor.",
  payment_method: "CASH_ON_DELIVERY",
  payment_status: "UNPAID",
  courier_name: null,
  promised_minutes: null,
  total: "485.00",
  items: [
    {
      name: "Cheeseburger",
      quantity: "2",
      unit_price: "180.00",
      line_total: "360.00",
      note: null,
      modifiers: [],
    },
  ],
  created_at: new Date().toISOString(),
  accepted_at: null,
  ready_at: null,
  dispatched_at: null,
  delivered_at: null,
  cancelled_at: null,
  rejection_reason: null,
};

const counts = {
  new: 1,
  accepted: 0,
  preparing: 0,
  ready: 0,
  dispatched: 0,
  delivered: 0,
  cancelled: 0,
};

function renderInbox(orders: unknown[] = [order]) {
  const accept = vi.fn(() => Promise.resolve(jsonResponse(order)));
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("delivery/counts")) return Promise.resolve(jsonResponse(counts));
      if (init?.method === "POST" && url.includes("/accept")) return accept();
      if (url.includes("delivery")) {
        return Promise.resolve(jsonResponse({ items: orders, total: orders.length }));
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
  render(<DeliveryInbox />, { wrapper });
  return { accept };
}

describe("delivery timers", () => {
  it("bands urgency instead of colouring everything late", () => {
    expect(urgency(3)).toBe("normal");
    expect(urgency(15)).toBe("warning");
    expect(urgency(40)).toBe("late");
  });

  it("counts elapsed minutes from the order time", () => {
    const now = Date.now();
    const eightMinutesAgo = new Date(now - 8 * 60_000).toISOString();
    expect(elapsedMinutes(eightMinutesAgo, now)).toBe(8);
  });
});

describe("DeliveryInbox", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the order with its total, note and primary actions", async () => {
    renderInbox();

    expect(await screen.findByText("2 × Cheeseburger")).toBeVisible();
    expect(screen.getByText("₺485,00")).toBeVisible();
    // The customer's note has to be readable at a glance, not truncated away.
    expect(screen.getByText(/Soğansız, zil çalışmıyor/)).toBeVisible();
    expect(screen.getByText("Kapıda nakit")).toBeVisible();
    // Accept/Reject are never hidden behind a menu.
    expect(screen.getByRole("button", { name: /Kabul Et/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Reddet/ })).toBeVisible();
  });

  it("asks for a preparation time before accepting", async () => {
    const user = userEvent.setup();
    const { accept } = renderInbox();

    await user.click(await screen.findByRole("button", { name: /Kabul Et/ }));
    // Title and confirm button share the wording, so query by role.
    expect(
      await screen.findByText("Hazırlama süresini seçin; müşteriye bu süre bildirilir."),
    ).toBeVisible();
    expect(accept).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "15 dk" }));
    await user.click(screen.getByRole("button", { name: /Siparişi kabul et/ }));
    expect(accept).toHaveBeenCalled();
  });

  it("requires a reason before a rejection can be sent", async () => {
    const user = userEvent.setup();
    renderInbox();

    await user.click(await screen.findByRole("button", { name: /Reddet/ }));
    const confirm = await screen.findByRole("button", { name: /^Reddet$/ });
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Ürün tükendi" }));
    expect(confirm).toBeEnabled();
  });

  it("offers a useful empty state rather than a blank screen", async () => {
    renderInbox([]);
    expect(await screen.findByText("Henüz paket sipariş yok")).toBeVisible();
  });
});
