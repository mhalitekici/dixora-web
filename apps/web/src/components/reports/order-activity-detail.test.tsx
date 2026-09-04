import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OrderActivityDetailDialog,
  type OrderActivityDetail,
} from "@/components/reports/order-activity-detail";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const detail: OrderActivityDetail = {
  order_id: "11111111-2222-3333-4444-555555555555",
  reference: "AD-11111111",
  created_at: "2026-08-08T18:30:00Z",
  branch_id: "99999999-0000-0000-0000-000000000001",
  status: "PAID",
  source: "WAITER",
  table_name: "B1",
  staff_name: "Ahmet Y.",
  member_code: "DX-4821",
  delivery_channel: null,
  customer_name: null,
  currency: "TRY",
  business_name: "Elixir Hotel",
  branch_name: "Merkez",
  branch_address: "Sahil Cad. No:12",
  branch_phone: "+90 252 000 00 00",
  submitted_at: "2026-08-08T18:31:00Z",
  accepted_at: "2026-08-08T18:32:00Z",
  paid_at: "2026-08-08T19:10:00Z",
  subtotal: "380.00",
  discount_total: "20.00",
  tax_total: "0.00",
  total: "360.00",
  paid_total: "300.00",
  remaining: "60.00",
  items: [
    {
      name: "Latte",
      quantity: "2",
      unit_price: "120.00",
      discount: "0.00",
      line_total: "240.00",
      status: "SERVED",
      note: null,
      modifiers: ["2x Ekstra shot"],
    },
    {
      name: "Cheesecake",
      quantity: "1",
      unit_price: "140.00",
      discount: "0.00",
      line_total: "140.00",
      status: "SERVED",
      note: "Az şekerli",
      modifiers: [],
    },
    {
      name: "Sahlep",
      quantity: "1",
      unit_price: "90.00",
      discount: "0.00",
      line_total: "90.00",
      status: "CANCELLED",
      note: null,
      modifiers: [],
    },
  ],
  payments: [
    {
      method: "CARD",
      amount: "300.00",
      status: "COMPLETED",
      reference: "POS-7788",
      recorded_at: "2026-08-08T19:10:00Z",
      recorded_by: "Ayşe K.",
    },
  ],
};

const stations = [
  { id: "st-kasa", name: "Kasa" },
  { id: "st-mutfak", name: "Mutfak" },
];

const devices = [
  {
    id: "pr-kasa",
    name: "Termal 1",
    code: "KASA1",
    preparation_station_id: "st-kasa",
    is_active: true,
  },
  {
    id: "pr-mutfak",
    name: "Mutfak Yazıcı",
    code: "MUT1",
    preparation_station_id: "st-mutfak",
    is_active: true,
  },
  {
    id: "pr-bozuk",
    name: "Arızalı Yazıcı",
    code: "OLD1",
    preparation_station_id: null,
    is_active: false,
  },
];

function setup(permissions: string[] = ["printing.manage"]) {
  const posted: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        posted.push({ url, body: JSON.parse(String(init.body)) });
        return Promise.resolve(jsonResponse({ id: "job" }, 201));
      }
      if (url.includes("auth/me")) {
        return Promise.resolve(
          jsonResponse({
            user: { id: "u1", displayName: "Ayşe K.", isSuperAdmin: false },
            permissions,
          }),
        );
      }
      if (url.includes("printing/devices")) {
        return Promise.resolve(jsonResponse(devices));
      }
      if (url.includes("catalog/stations")) {
        return Promise.resolve(jsonResponse(stations));
      }
      if (url.includes("reports/order-activity/")) {
        return Promise.resolve(jsonResponse(detail));
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
  render(
    <OrderActivityDetailDialog orderId={detail.order_id} onClose={() => {}} />,
    { wrapper },
  );
  return { posted };
}

describe("OrderActivityDetailDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads back what was ordered, down to modifiers and notes", async () => {
    setup();
    expect(await screen.findByText("Latte")).toBeVisible();
    expect(screen.getByText("+ 2x Ekstra shot")).toBeVisible();
    expect(screen.getByText("Not: Az şekerli")).toBeVisible();
  });

  it("shows what was collected and what is still owed", async () => {
    setup();
    expect(await screen.findByText("POS-7788", { exact: false })).toBeVisible();
    expect(screen.getByText("Ödenen")).toBeVisible();
    // The remaining balance comes from the API, never from client arithmetic.
    expect(screen.getByText("₺60,00")).toBeVisible();
  });

  it("keeps a cancelled line visible on screen but off the receipt", async () => {
    const user = userEvent.setup();
    setup();
    // The manager still needs to see it was ordered and then struck off.
    expect(await screen.findByText("Sahlep")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Fiş çıkar/ }));
    const receipt = await screen.findByText("*** YENİDEN YAZDIRMA ***");
    const paper = receipt.closest(".dixora-receipt") as HTMLElement;
    expect(paper.textContent).toContain("Latte");
    expect(paper.textContent).not.toContain("Sahlep");
  });

  it("queues the reprint as a REPRINT job, never as an original", async () => {
    const user = userEvent.setup();
    const { posted } = setup();
    await user.click(await screen.findByRole("button", { name: /Fiş çıkar/ }));
    await user.click(
      await screen.findByRole("button", { name: /Yazıcıya gönder/ }),
    );
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({
      order_id: detail.order_id,
      kind: "REPRINT",
      // Nothing chosen: the API resolves the branch's own bill printer.
      printer_device_id: null,
    });
  });

  it("routes the reprint to the station the manager picked", async () => {
    const user = userEvent.setup();
    const { posted } = setup();
    await user.click(await screen.findByRole("button", { name: /Fiş çıkar/ }));
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Mutfak · Mutfak Yazıcı/ }));
    await user.click(screen.getByRole("button", { name: /Yazıcıya gönder/ }));

    expect(posted[0].body).toMatchObject({
      printer_device_id: "pr-mutfak",
      // Sent alongside so the job is filed against the right station.
      preparation_station_id: "st-mutfak",
    });
  });

  it("never offers an inactive printer", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: /Fiş çıkar/ }));
    await user.click(await screen.findByRole("combobox"));
    expect(await screen.findByRole("option", { name: /Termal 1/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /Arızalı/ })).toBeNull();
  });

  it("hides the printer queue from a reader who cannot print", async () => {
    const user = userEvent.setup();
    setup(["reports.read"]);
    await user.click(await screen.findByRole("button", { name: /Fiş çıkar/ }));
    // The browser print path stays; only the bridge queue is withheld.
    expect(await screen.findByRole("button", { name: /Yazdır/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Yazıcıya gönder/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
