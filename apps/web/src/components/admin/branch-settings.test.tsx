import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BranchSettings } from "@/components/admin/branch-settings";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const branch = {
  id: "11111111-1111-1111-1111-111111111111",
  tenant_id: "22222222-2222-2222-2222-222222222222",
  name: "Erenköy",
  slug: "erenkoy",
  timezone: "Europe/Istanbul",
  address: null,
  phone: null,
  working_hours: {},
  is_active: true,
  archived_at: null as string | null,
};

const archivedBranch = {
  ...branch,
  id: "33333333-3333-3333-3333-333333333333",
  name: "Maltepe",
  slug: "maltepe",
  is_active: false,
  archived_at: "2026-08-01T10:00:00Z",
};

function stubApi(pricing: Record<string, unknown>, branches = [branch]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("branches/pricing")) return Promise.resolve(jsonResponse(pricing));
      if (url.includes("branches/usage")) {
        return Promise.resolve(
          jsonResponse({
            plan_name: "Dixora Standard",
            max_branches: null,
            active_branches: branches.filter((item) => item.is_active).length,
            total_branches: branches.length,
            can_create: true,
          }),
        );
      }
      if (url.includes("branches")) return Promise.resolve(jsonResponse(branches));
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<BranchSettings />, { wrapper });
}

const paidPricing = {
  currency: "TRY",
  base_monthly_price: "1200.00",
  included_branches: 1,
  additional_branch_price: "850.00",
  active_branches: 1,
  billable_extra_branches: 0,
  monthly_total: "1200.00",
  next_branch_monthly_total: "2050.00",
};

describe("BranchSettings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows what the business pays now and what one more branch would cost", async () => {
    stubApi(paidPricing);
    renderSettings();

    expect(await screen.findByText("Aylık abonelik tutarı")).toBeVisible();
    expect(await screen.findByText("₺1.200,00")).toBeVisible();
    // The owner must see the consequence before opening a branch.
    expect(await screen.findByText("₺2.050,00")).toBeVisible();
  });

  it("hides the price panel for a business that is not billed yet", async () => {
    stubApi({ ...paidPricing, base_monthly_price: "0.00", monthly_total: "0.00" });
    renderSettings();

    expect(await screen.findByText("Şubeler")).toBeVisible();
    expect(screen.queryByText("Aylık abonelik tutarı")).toBeNull();
  });

  it("offers archiving for an active branch", async () => {
    stubApi(paidPricing);
    renderSettings();

    expect(await screen.findByRole("button", { name: /Şubeyi arşivle/ })).toBeVisible();
  });

  it("offers reopening for an archived branch and says history is kept", async () => {
    stubApi({ ...paidPricing, active_branches: 0 }, [archivedBranch]);
    renderSettings();

    expect(
      await screen.findByRole("button", { name: /Şubeyi yeniden aç/ }),
    ).toBeVisible();
    expect(await screen.findByText(/geçmiş kayıtlar korunuyor/i)).toBeVisible();
  });
});
