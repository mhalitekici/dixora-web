import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AuditChanges, redactAudit } from "./audit-changes";

it("hides credentials recursively while preserving opening cash", () => {
  expect(
    redactAudit({
      opening_cash: "100",
      pin_hash: "private",
      nested: { credential: "private", customer_phone: "555" },
    }),
  ).toEqual({
    opening_cash: "100",
    pin_hash: "[Gizlendi]",
    nested: { credential: "[Gizlendi]", customer_phone: "[Gizlendi]" },
  });
  render(
    <AuditChanges
      previous={{ opening_cash: "100", password: "private" }}
      next={{ opening_cash: "200", password: "new-secret" }}
    />,
  );
  expect(screen.getByText("Açılış nakdi")).toBeVisible();
  expect(screen.queryByText("private")).not.toBeInTheDocument();
});

it("explains nested changes and permissions without raw JSON", () => {
  const { container } = render(
    <AuditChanges
      previous={{ permissions: ["orders.read"] }}
      next={{
        permissions: ["orders.create"],
        items: [{ quantity: 2, note: "Sos ayrı", credential: "private" }],
      }}
    />,
  );
  expect(screen.getByText("Sipariş oluşturma ve ürün ekleme")).toBeVisible();
  expect(screen.getByText("Adet: 2 · Not: Sos ayrı")).toBeVisible();
  expect(container.textContent).not.toContain("private");
  expect(container.textContent).not.toContain("{");
});
