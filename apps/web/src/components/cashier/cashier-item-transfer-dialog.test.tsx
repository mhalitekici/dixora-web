import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CashierItemTransferDialog,
  stepTransferQuantity,
  validTransferQuantity,
} from "@/components/cashier/cashier-item-transfer-dialog";

describe("CashierItemTransferDialog", () => {
  it("accepts only whole transferable quantities", () => {
    expect(validTransferQuantity("1", 4)).toBe(1);
    expect(validTransferQuantity("2", 4)).toBe(2);
    expect(validTransferQuantity("4", 4)).toBe(4);
    expect(validTransferQuantity("0", 4)).toBeNull();
    expect(validTransferQuantity("-1", 4)).toBeNull();
    expect(validTransferQuantity("1.5", 4)).toBeNull();
    expect(validTransferQuantity("5", 4)).toBeNull();
  });

  it("steps by exactly one and stays within the item limits", async () => {
    const user = userEvent.setup();
    render(
      <CashierItemTransferDialog
        open
        sourceTable={{ id: "table-1", name: "Masa 1", state: "PREPARING" }}
        items={[
          {
            id: "item-1",
            product_name_snapshot: "Çay",
            quantity: "4",
            status: "ACCEPTED",
          },
        ]}
        tables={[
          { id: "table-1", name: "Masa 1", state: "PREPARING" },
          { id: "table-2", name: "Masa 2", state: "AVAILABLE" },
        ]}
        onOpenChange={() => {}}
        onTransfer={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /Çay ürününü seç/ }));
    const input = screen.getByRole("spinbutton", {
      name: /Çay taşınacak adet/,
    });
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "4");
    expect(input).toHaveAttribute("step", "1");
    expect(input).toHaveValue(4);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveValue(3);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue(4);

    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveValue(1);

    fireEvent.change(input, { target: { value: "1.5" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("tam sayı olmalı");
    expect(screen.getByRole("button", { name: /Devam/ })).toBeDisabled();
  });

  it("normalizes stepping helpers without producing decimals", () => {
    expect(stepTransferQuantity("1", 1, 4)).toBe("2");
    expect(stepTransferQuantity("4", -1, 4)).toBe("3");
    expect(stepTransferQuantity("4", 1, 4)).toBe("4");
    expect(stepTransferQuantity("1", -1, 4)).toBe("1");
  });
});
