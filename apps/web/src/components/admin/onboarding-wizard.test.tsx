import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnboardingWizard } from "@/components/admin/onboarding-wizard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const empty = {
  offers_delivery: null,
  delivery_platforms: [],
  payment_methods: [],
  accepts_meal_cards: null,
  meal_card_providers: [],
  monthly_order_volume: null,
  table_count: null,
  heard_from: null,
  completed: false,
};

function renderWizard(saveResponse: unknown = { ...empty, completed: true }) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return Promise.resolve(jsonResponse(saveResponse));
      return Promise.resolve(jsonResponse(empty));
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<OnboardingWizard />, { wrapper });
}

describe("OnboardingWizard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks about delivery before anything else", async () => {
    renderWizard();
    expect(await screen.findByText("Paket servisiniz var mı?")).toBeVisible();
  });

  it("skips the platform question when the venue does not deliver", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(await screen.findByRole("button", { name: /sadece yerinde servis/i }));
    await user.click(screen.getByRole("button", { name: /Devam/ }));

    // Straight to payments — asking which marketplaces they use would be noise.
    expect(
      await screen.findByText("Hangi ödeme yöntemlerini kabul ediyorsunuz?"),
    ).toBeVisible();
  });

  it("reports what the answers actually configured", async () => {
    const user = userEvent.setup();
    renderWizard({
      ...empty,
      completed: true,
      applied: {
        tables_created: 12,
        area_created: true,
        delivery_enabled: true,
        payment_methods: ["CASH", "CARD"],
      },
    });

    await user.click(await screen.findByRole("button", { name: /Şimdilik atla/ }));

    expect(await screen.findByText("Kurulum tamam")).toBeVisible();
    expect(screen.getByText(/12 masa/)).toBeVisible();
    expect(screen.getByText(/Paket servis açıldı/)).toBeVisible();
  });
});
