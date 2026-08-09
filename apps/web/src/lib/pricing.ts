/**
 * Canonical subscription pricing for every customer-facing surface.
 *
 * These figures mirror `apps/api/app/services/pricing.py`, which is the billing
 * source of truth. They live in one module because the same numbers appear on
 * the landing page, in the registration consent checkbox and inside the legally
 * binding membership agreement — a price that disagrees between those is a
 * consumer-law problem, not just a typo. Change them here, never inline.
 */

export const BASE_MONTHLY_PRICE = 1200;
export const INCLUDED_BRANCHES = 1;
export const ADDITIONAL_BRANCH_PRICE = 850;
export const CURRENCY = "TRY";

const formatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPrice(value: number): string {
  return formatter.format(value);
}

/** base + max(activeBranches - included, 0) x additional. Archived branches never count. */
export function monthlyTotal(activeBranches: number): number {
  const extra = Math.max(activeBranches - INCLUDED_BRANCHES, 0);
  return BASE_MONTHLY_PRICE + extra * ADDITIONAL_BRANCH_PRICE;
}

export const BASE_MONTHLY_PRICE_LABEL = formatPrice(BASE_MONTHLY_PRICE);
export const ADDITIONAL_BRANCH_PRICE_LABEL = formatPrice(ADDITIONAL_BRANCH_PRICE);
