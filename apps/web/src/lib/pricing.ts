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

/**
 * VAT-inclusive price labels for customer-facing copy.
 *
 * Dixora's published consumer prices are tax-inclusive (KDV dahil) — there is
 * no separate ex-VAT figure shown anywhere in the product. Every surface that
 * states a price to a prospect or a business owner uses these, so the "KDV
 * dahil" qualifier is never typed out ad hoc and never drifts out of sync with
 * the number next to it.
 */
export const BASE_MONTHLY_PRICE_LABEL_VAT_INCLUSIVE = `${BASE_MONTHLY_PRICE_LABEL} (KDV dahil)`;
export const ADDITIONAL_BRANCH_PRICE_LABEL_VAT_INCLUSIVE = `${ADDITIONAL_BRANCH_PRICE_LABEL} (KDV dahil)`;
