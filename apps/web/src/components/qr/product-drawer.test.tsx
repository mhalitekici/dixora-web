import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProductDrawer } from "./product-drawer";
import type { QrProductDto } from "./types";

const product: QrProductDto = {
  id: "product-1",
  category_id: "category-1",
  name: "Köfte",
  description: null,
  selling_price: "200.00",
  image_url: null,
  allergens: [],
  calories: null,
  modifier_groups: [],
};

describe("QR product quantities", () => {
  it("adds whole products at the full price", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductDrawer
        product={product}
        currency="TRY"
        locale="tr"
        orderingEnabled
        open
        onOpenChange={vi.fn()}
        onAdd={onAdd}
      />,
    );
    expect(screen.queryByRole("button", { name: "Yarım porsiyon" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Adedi artır" }));
    await user.click(screen.getByRole("button", { name: /Sepete ekle.*400/ }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 2, unitPrice: "200.00" }),
    );
  });
});
