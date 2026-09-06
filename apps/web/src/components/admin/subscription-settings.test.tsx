import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SubscriptionSettings } from "@/components/admin/subscription-settings";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("branches/pricing")) {
        return Promise.resolve(
          jsonResponse({
            currency: "TRY",
            base_monthly_price: "1200.00",
            included_branches: 1,
            additional_branch_price: "850.00",
            active_branches: 1,
            billable_extra_branches: 0,
            monthly_total: "1200.00",
          }),
        );
      }
      if (url.includes("auth/me")) {
        return Promise.resolve(jsonResponse({ tenant: { state: "ACTIVE" } }));
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {(<SubscriptionSettings />) as ReactNode}
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SubscriptionSettings pricing display", () => {
  it("labels the monthly amount as VAT-inclusive", async () => {
    stubApi();
    renderPage();

    expect(await screen.findByText(/Aylık tutar \(KDV dahil\)/)).toBeVisible();
  });

  it("never shows a VAT-exclusive price", async () => {
    stubApi();
    const { container } = renderPage();

    await screen.findByText(/Aylık tutar \(KDV dahil\)/);
    expect(container.textContent).not.toContain("KDV hariç");
    expect(container.textContent).not.toMatch(/\+\s*KDV/);
  });
});
