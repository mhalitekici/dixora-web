import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BusinessDetail } from "./business-detail";
import * as platformApi from "./platform-admin-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

describe("manual membership extension", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refreshes the visible next payment date immediately after extension", async () => {
    const business = {
      id: "business-1",
      name: "Dixora Cafe",
      slug: "cafe",
      business_type: "RESTAURANT",
      state: "ACTIVE" as const,
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
    };
    const overview = {
      ...business,
      owner_name: "Ayşe",
      owner_email: null,
      owner_phone: null,
      active_branches: 1,
      total_branches: 1,
      user_count: 1,
      plan_name: "Standart",
      currency: "TRY",
      monthly_total: "1000.00",
      base_monthly_price: "1000.00",
      included_branches: 1,
      additional_branch_price: "0.00",
      billable_extra_branches: 0,
      next_payment_at: "2026-10-01T00:00:00Z",
      trial_ends_at: null,
    };
    vi.spyOn(platformApi, "getBusiness").mockResolvedValue(business);
    vi.spyOn(platformApi, "getBusinessOverview").mockImplementation(
      async () => overview,
    );
    vi.spyOn(platformApi, "reactivateBusiness").mockImplementation(async () => {
      overview.next_payment_at = "2026-10-31T00:00:00Z";
      return business;
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessDetail businessId="business-1" />
      </QueryClientProvider>,
    );
    const day = (value: string) =>
      new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(
        new Date(value),
      );
    expect(await screen.findByText(day("2026-10-01T00:00:00Z"))).toBeVisible();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Aboneliği manuel uzat" }),
    );
    await user.click(screen.getByRole("button", { name: "Onayla" }));
    await waitFor(() =>
      expect(platformApi.getBusinessOverview).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByText(day("2026-10-31T00:00:00Z"))).toBeVisible();
  });
});
