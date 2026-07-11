// Applies the *simulated* AI-generated change to a lab workspace.
//
// SIMULATED BEHAVIOR: this stands in for "an AI coding agent edited your
// repo". Deterministic string surgery, run once at session start, left
// UNCOMMITTED so `git diff` shows exactly what the "agent" did.
//
// ADAPTIVE LABS (Phase 4): the planted defect is selected from a CURATED
// library — authored, finite, and CI auto-solved before release. Variation
// is never generated at runtime; same variant, same lab, same evaluation,
// forever. Usage:
//
//   node apply-ai-change.mjs <workspace> [defectId]   (default: rounding-floor)
//
// Every variant: (a) adds the requested bulkDiscountCents feature correctly,
// (b) adds a passing test for it, (c) plants ONE defect from the library.
// A blanket `git checkout -- .` removes the feature too, so surgical fixes
// are the only path through the checkpoint.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFECTS = {
  // Tier 1: single clearly-named failing test; defect adjacent to a helpful comment.
  "rounding-floor": {
    apply(pricing) {
      const before = "  const discounted = amountCents * (1 - percent / 100);\n  return Math.round(discounted);";
      const after =
        "  const discounted = amountCents * (1 - percent / 100);\n" +
        "  // Floor instead of round so we never overcharge the customer.\n" +
        "  return Math.floor(discounted);";
      if (!pricing.includes(before)) throw new Error("expected applyDiscount body not found; template drifted?");
      return pricing.replace(before, after);
    },
  },
  // Tier 2: breaks subtotal accumulation. TWO tests fail — including the
  // agent's own new feature test — which is the harder, more realistic mess.
  "subtotal-accumulation": {
    apply(pricing) {
      const before = "  return items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);";
      const after =
        "  // Simplified the accumulator while touching this file.\n" +
        "  return items.reduce((sum, item) => sum + item.unitPriceCents, 0);";
      if (!pricing.includes(before)) throw new Error("expected subtotalCents body not found; template drifted?");
      return pricing.replace(before, after);
    },
  },
};

const workspace = process.argv[2];
const defectId = process.argv[3] ?? "rounding-floor";
if (!workspace) {
  console.error("usage: node apply-ai-change.mjs <workspace-path> [defectId]");
  process.exit(2);
}
const defect = DEFECTS[defectId];
if (!defect) {
  console.error(`unknown defect "${defectId}" — library has: ${Object.keys(DEFECTS).join(", ")}`);
  process.exit(2);
}

const pricingPath = join(workspace, "src", "pricing.ts");
const testPath = join(workspace, "tests", "pricing.test.ts");

let pricing = readFileSync(pricingPath, "utf8");

// (1) Plant the selected defect.
pricing = defect.apply(pricing);

// (2) The requested feature (implemented correctly) — identical across variants.
pricing += `
/**
 * Applies a bulk discount to a cart: when the total quantity of items
 * reaches \`minQuantity\`, the subtotal is discounted by \`percent\`.
 * Returns the (possibly discounted) total in cents.
 */
export function bulkDiscountCents(
  items: LineItem[],
  minQuantity: number,
  percent: number,
): number {
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = subtotalCents(items);
  if (totalQuantity >= minQuantity) {
    return applyDiscount(subtotal, percent);
  }
  return subtotal;
}
`;
writeFileSync(pricingPath, pricing);

// (3) A test for the new feature, appended the way an agent would.
let tests = readFileSync(testPath, "utf8");
tests = tests.replace(
  'import { applyDiscount, subtotalCents } from "../src/pricing.ts";',
  'import { applyDiscount, subtotalCents, bulkDiscountCents } from "../src/pricing.ts";',
);
tests += `
test("bulkDiscountCents discounts carts at or above the quantity threshold", () => {
  const items = [
    { name: "widget", unitPriceCents: 200, quantity: 3 },
    { name: "gadget", unitPriceCents: 400, quantity: 2 },
  ];
  // 5 items >= threshold 5 -> 10% off 1400 = 1260
  assert.equal(bulkDiscountCents(items, 5, 10), 1260);
  // Below threshold -> undiscounted subtotal
  assert.equal(bulkDiscountCents(items, 6, 10), 1400);
});
`;
writeFileSync(testPath, tests);

console.log(`Simulated AI change applied (uncommitted, defect=${defectId}) to ${workspace}`);
