import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BusinessSettings } from "@/components/admin/business-settings";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const business = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Aleyin Mutfağı",
  slug: "aleyin-mutfagi",
  business_type: "RESTAURANT",
  state: "ACTIVE" as const,
  is_active: true,
  default_currency: "TRY",
  prevent_negative_stock: true,
  theme_mode: "SYSTEM" as const,
  created_at: "2026-01-05T09:00:00Z",
};

function stubApi() {
  const patches: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("businesses")) {
        if (init?.method === "PATCH") {
          patches.push(JSON.parse(String(init.body)));
          return Promise.resolve(
            jsonResponse({ ...business, theme_mode: "LIGHT" }),
          );
        }
        return Promise.resolve(
          jsonResponse({ items: [business], total: 1, limit: 50, offset: 0 }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  return patches;
}

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {(<BusinessSettings />) as ReactNode}
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function themeSelect() {
  return screen.findByRole("combobox", {
    name: "QR Menü ve Çalışan Ekranı Teması",
  });
}

describe("BusinessSettings theme control", () => {
  it("explains what the setting actually governs", async () => {
    stubApi();
    renderSettings();

    expect(
      await screen.findByText("QR Menü ve Çalışan Ekranı Teması"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "QR menü ve çalışanların mobil ekranlarında kullanılacak görünümü belirler.",
      ),
    ).toBeInTheDocument();
  });

  it("offers exactly the three modes the API accepts", async () => {
    const user = userEvent.setup();
    stubApi();
    renderSettings();

    await user.click(await themeSelect());

    expect(
      await screen.findByRole("option", { name: "Açık" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Karanlık" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Cihaz ayarını kullan" }),
    ).toBeInTheDocument();
  });

  it("sends the chosen mode with the rest of the profile", async () => {
    const user = userEvent.setup();
    const patches = stubApi();
    renderSettings();

    await user.click(await themeSelect());
    await user.click(await screen.findByRole("option", { name: "Açık" }));
    await user.click(
      screen.getByRole("button", { name: /değişiklikleri kaydet/i }),
    );

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({
      theme_mode: "LIGHT",
      name: business.name,
    });
  });
});
