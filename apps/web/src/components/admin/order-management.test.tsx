import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adminApi } from "./admin-api";
import { OrderManagement } from "./order-management";

describe("admin receipt lookup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("searches receipts on the server and keeps focus while typing a multi-digit number", async () => {
    const orders = vi
      .spyOn(adminApi, "orders")
      .mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <OrderManagement />
      </QueryClientProvider>,
    );
    const input = await screen.findByRole("searchbox", { name: "Fiş no ara" });
    const user = userEvent.setup();
    await user.type(input, "123");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("123");
    fireEvent.change(screen.getByLabelText("Fiş tarihi"), {
      target: { value: "2026-10-09" },
    });
    await waitFor(() =>
      expect(orders).toHaveBeenLastCalledWith(
        expect.objectContaining({
          receiptNumber: 123,
          receiptDate: "2026-10-09",
          offset: 0,
        }),
        expect.anything(),
      ),
    );
  });
});
