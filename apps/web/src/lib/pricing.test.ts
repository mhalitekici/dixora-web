import { describe, expect, it } from "vitest";

import {
  ADDITIONAL_BRANCH_PRICE,
  BASE_MONTHLY_PRICE,
  INCLUDED_BRANCHES,
  monthlyTotal,
} from "./pricing";
import {
  MEMBERSHIP_AGREEMENT_SECTIONS,
  MEMBERSHIP_AGREEMENT_VERSION,
} from "@/components/marketing/membership-agreement";

describe("subscription pricing", () => {
  // These must stay in lockstep with apps/api/app/services/pricing.py.
  it("matches the published price points", () => {
    expect(monthlyTotal(1)).toBe(1200);
    expect(monthlyTotal(2)).toBe(2050);
    expect(monthlyTotal(3)).toBe(2900);
    expect(monthlyTotal(5)).toBe(4600);
  });

  it("never prices below the base", () => {
    expect(monthlyTotal(0)).toBe(BASE_MONTHLY_PRICE);
  });

  it("charges the additional-branch price for each branch past the included one", () => {
    expect(monthlyTotal(INCLUDED_BRANCHES + 1) - monthlyTotal(INCLUDED_BRANCHES)).toBe(
      ADDITIONAL_BRANCH_PRICE,
    );
  });
});

describe("membership agreement", () => {
  const text = MEMBERSHIP_AGREEMENT_SECTIONS.flatMap(
    (section) => section.paragraphs,
  ).join(" ");

  it("quotes the current base price, not a stale one", () => {
    // A binding contract that advertises the wrong price is a legal problem.
    expect(text).toContain("1.200,00");
    expect(text).not.toContain("1.199,99");
  });

  it("discloses the per-branch charge and that archived branches are free", () => {
    expect(text).toContain("850,00");
    expect(text.toLowerCase()).toContain("arşivlenen");
  });

  it("carries a version so older acceptances stay distinguishable", () => {
    expect(MEMBERSHIP_AGREEMENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-v\d+$/);
  });
});
