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
