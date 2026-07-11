import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount, subtotalCents } from "../src/pricing.ts";

test("applyDiscount rounds half-up to the nearest cent", () => {
  // 999 * 0.5 = 499.5 -> conventional rounding gives 500
  assert.equal(applyDiscount(999, 50), 500);
});

test("applyDiscount with 0% returns the original amount", () => {
  assert.equal(applyDiscount(1000, 0), 1000);
});

test("applyDiscount computes ordinary discounts", () => {
  assert.equal(applyDiscount(1000, 15), 850);
});

test("applyDiscount rejects out-of-range percentages", () => {
  assert.throws(() => applyDiscount(500, 101), RangeError);
  assert.throws(() => applyDiscount(500, -1), RangeError);
});

test("subtotalCents sums line items", () => {
  assert.equal(
    subtotalCents([
      { name: "widget", unitPriceCents: 250, quantity: 2 },
      { name: "gadget", unitPriceCents: 499, quantity: 1 },
    ]),
    999,
  );
});
