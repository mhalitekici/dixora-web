import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LOYALTY_PRESETS, LoyaltyPresetPicker } from "./loyalty-presets";

describe("loyalty presets", () => {
  it("covers the campaign shapes owners actually ask for", () => {
    const ids = LOYALTY_PRESETS.map((preset) => preset.id);
    expect(ids).toContain("coffee-5");
    expect(ids).toContain("visit-10");
  });

  it("fills in every mechanic so only the product choice is left", () => {
    for (const preset of LOYALTY_PRESETS) {
      expect(preset.values.threshold).toBeGreaterThan(0);
      expect(["VISIT_COUNT", "PRODUCT_QUANTITY"]).toContain(preset.values.campaign_type);
      expect(preset.values.minimum_order_amount).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("hands the chosen preset back to the form", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<LoyaltyPresetPicker onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /5 kahve alana 1 bedava/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].values).toMatchObject({
      campaign_type: "PRODUCT_QUANTITY",
      threshold: 5,
    });
  });

  it("marks the active preset so the owner sees what is applied", () => {
    render(<LoyaltyPresetPicker onSelect={() => {}} activePresetId="visit-10" />);
    const active = screen.getByRole("button", { name: /10 ziyarette 1 ödül/ });
    expect(active.className).toContain("border-brand");
  });
});

describe("membership code length rule", () => {
  it("accepts the 7-character card codes the backend now issues", async () => {
    const { MIN_MEMBER_CODE_LENGTH } = await import("./loyalty-presets");
    // Regression: a leftover `length < 8` check rejected every DXR6W96-style
    // code, so the cashier's "Bağla" button threw instead of attaching.
    expect("DXR6W96".length).toBeGreaterThanOrEqual(MIN_MEMBER_CODE_LENGTH);
    expect(MIN_MEMBER_CODE_LENGTH).toBeLessThanOrEqual(7);
  });
});
