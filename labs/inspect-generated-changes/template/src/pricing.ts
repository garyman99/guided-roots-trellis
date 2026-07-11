/**
 * Pricing utilities for the demo storefront.
 * All money is handled in integer cents.
 */

export interface LineItem {
  name: string;
  unitPriceCents: number;
  quantity: number;
}

/**
 * Applies a percentage discount to an amount in cents.
 * Rounds half-up to the nearest cent so totals match the finance team's
 * spreadsheet, which uses conventional rounding.
 */
export function applyDiscount(amountCents: number, percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`percent must be between 0 and 100, got ${percent}`);
  }
  const discounted = amountCents * (1 - percent / 100);
  return Math.round(discounted);
}

/** Sums a list of line items into a subtotal in cents. */
export function subtotalCents(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
}
