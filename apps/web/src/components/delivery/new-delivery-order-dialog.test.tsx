import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewDeliveryOrderDialog } from "@/components/delivery/new-delivery-order-dialog";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const products = [
  {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    name: "Cheeseburger",
    selling_price: "180.00",
    is_available: true,
  },
  {
    id: "aaaaaaaa-0000-0000-0000-000000000002",
    name: "Ayran",
    selling_price: "40.00",
    is_available: true,
  },
  {
    id: "aaaaaaaa-0000-0000-0000-000000000003",
    name: "Sezon Tatlısı",
    selling_price: "120.00",
    // Out of stock: must never be offerable to a caller on the phone.
    is_available: false,
  },
  {
    id: "aaaaaaaa-0000-0000-0000-000000000004",
    name: "Kendi Kahveni Yap",
    selling_price: "0.00",
    is_available: true,
  },
];

const coffeeDetail = {
  ...products[3],
  modifier_groups: [
    {
      id: "coffee-base",
      name: "Kahve bazı",
      is_required: true,
      minimum_selection: 1,
      maximum_selection: 1,
      modifiers: [
        { id: "espresso", name: "Espresso", price_delta: "50.00" },
        { id: "filter", name: "Filtre Kahve", price_delta: "40.00" },
      ],
    },
    {
      id: "milk",
      name: "Süt",
      is_required: true,
      minimum_selection: 1,
      maximum_selection: 1,
      modifiers: [
        { id: "normal", name: "Normal", price_delta: "0.00" },
        { id: "oat", name: "Yulaf", price_delta: "15.00" },
      ],
    },
    {
      id: "extras",
      name: "Ekstra",
      is_required: false,
      minimum_selection: 0,
      maximum_selection: 3,
      modifiers: [
        { id: "extra-shot", name: "Extra Shot", price_delta: "30.00" },
      ],
    },
  ],
};

function setup() {
  const posted: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return Promise.resolve(jsonResponse({ id: "created" }, 201));
      }
      const detail = products.find((product) => url.endsWith(product.id));
      if (detail) {
        return Promise.resolve(
          jsonResponse(
            detail.id === coffeeDetail.id
              ? coffeeDetail
              : { ...detail, modifier_groups: [] },
          ),
        );
      }
      if (url.includes("catalog/products")) {
        return Promise.resolve(
          jsonResponse({ items: products, total: products.length }),
        );
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
  render(<NewDeliveryOrderDialog open onOpenChange={() => {}} />, { wrapper });
  return { posted };
}

describe("NewDeliveryOrderDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never offers a product that is out of stock", async () => {
    setup();
    expect(await screen.findByText("Cheeseburger")).toBeVisible();
    expect(screen.queryByText("Sezon Tatlısı")).not.toBeInTheDocument();
  });

  it("cannot submit an empty order", async () => {
    setup();
    await screen.findByText("Cheeseburger");
    expect(
      screen.getByRole("button", { name: /Siparişi oluştur/ }),
    ).toBeDisabled();
  });

  it("totals the basket as items are added", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByText("Cheeseburger"));
    await user.click(
      screen.getByRole("button", { name: /Cheeseburger adet artır/ }),
    );
    await user.click(screen.getByText("Ayran"));

    // 2 × 180 + 40
    expect(screen.getByText("₺400,00")).toBeVisible();
  });

  it("blocks a courier order until an address is entered", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByText("Cheeseburger"));
    await user.click(screen.getByRole("button", { name: "Paket Servis" }));

    const submit = screen.getByRole("button", { name: /Siparişi oluştur/ });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Adres"), "Bağdat Cad. No:5");
    expect(submit).toBeEnabled();
  });

  it("sends what the cashier typed, with a fresh idempotency key", async () => {
    const user = userEvent.setup();
    const { posted } = setup();

    await user.click(await screen.findByText("Cheeseburger"));
    await user.type(screen.getByLabelText("Müşteri adı"), "Ahmet");
    await user.type(screen.getByLabelText("Telefon"), "05551112233");
    await user.type(screen.getByLabelText("Sipariş notu"), "Soğansız");
    await user.click(screen.getByRole("button", { name: "Kart" }));
    await user.click(screen.getByRole("button", { name: /Siparişi oluştur/ }));

    expect(posted).toHaveLength(1);
    const body = posted[0] as Record<string, unknown>;
    expect(body.channel).toBe("PHONE");
    expect(body.customer_name).toBe("Ahmet");
    expect(body.customer_note).toBe("Soğansız");
    expect(body.payment_method).toBe("CARD_ON_DELIVERY");
    expect(body.items).toEqual([{ product_id: products[0].id, quantity: "1" }]);
    // The backend requires at least 8 characters for the idempotency key.
    expect(String(body.idempotency_key).length).toBeGreaterThanOrEqual(8);
  });

  it("requires package modifiers and includes their price in the total", async () => {
    const user = userEvent.setup();
    const { posted } = setup();

    await user.click(await screen.findByText("Kendi Kahveni Yap"));
    expect(
      (await screen.findAllByText("Zorunlu · min 1 / maks 1"))[0],
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Siparişe ekle/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Lütfen Kahve bazı seçeneğinden en az 1 seçim yapın.",
    );

    await user.click(screen.getByRole("checkbox", { name: /^Espresso/ }));
    await user.click(screen.getByRole("checkbox", { name: /^Yulaf/ }));
    await user.click(screen.getByRole("checkbox", { name: /^Extra Shot/ }));
    expect(
      screen.getByRole("button", { name: /Siparişe ekle · ₺95,00/ }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Siparişe ekle/ }));

    expect(screen.getByText("Espresso, Yulaf, Extra Shot")).toBeVisible();
    expect(screen.getAllByText("₺95,00")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /Siparişi oluştur/ }));

    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual(
      expect.objectContaining({
        items: [
          {
            product_id: coffeeDetail.id,
            quantity: "1",
            modifiers: [
              { modifier_id: "espresso", quantity: 1 },
              { modifier_id: "oat", quantity: 1 },
              { modifier_id: "extra-shot", quantity: 1 },
            ],
          },
        ],
      }),
    );
  });
});
