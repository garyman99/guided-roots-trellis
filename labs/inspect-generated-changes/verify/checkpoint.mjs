// Deterministic behavioral verification for the "inspect-generated-changes" lab.
//
// Runs INSIDE the lab workspace (untrusted code executes only in the lab
// environment, never on the platform host). Prints a single JSON line so the
// evaluator parses results instead of scraping prose.
//
// Behavior checks beat regex checks: any correct fix passes, regardless of
// how the learner wrote it.
const checks = [];

async function check(id, label, fn) {
  try {
    await fn();
    checks.push({ id, label, ok: true });
  } catch (err) {
    checks.push({ id, label, ok: false, detail: String(err?.message ?? err).slice(0, 300) });
  }
}

let mod = null;
await check("module-loads", "src/pricing.ts loads without errors", async () => {
  mod = await import(new URL("src/pricing.ts", `file://${process.cwd()}/`).href);
});

if (mod) {
  // UNIVERSAL across the defect library: any variant's planted defect breaks
  // one of these original behaviors, and any correct fix restores them.
  // Behavior checks beat variant-aware checks — this verifier never needs to
  // know which defect was planted.
  await check("defect-fixed", "original pricing behaviors are restored (the planted defect is fixed)", () => {
    const got = mod.applyDiscount(999, 50);
    if (got !== 500) throw new Error(`applyDiscount(999, 50) returned ${got}, expected 500`);
    const got2 = mod.applyDiscount(1001, 25);
    if (got2 !== 751) throw new Error(`applyDiscount(1001, 25) returned ${got2}, expected 751`);
    const sub = mod.subtotalCents([
      { name: "w", unitPriceCents: 250, quantity: 2 },
      { name: "g", unitPriceCents: 499, quantity: 1 },
    ]);
    if (sub !== 999) throw new Error(`subtotalCents returned ${sub}, expected 999`);
  });

  await check("feature-kept", "bulkDiscountCents still exists and works (fix was surgical, not a blanket revert)", () => {
    if (typeof mod.bulkDiscountCents !== "function") {
      throw new Error("bulkDiscountCents is missing — the new feature was removed instead of the defect being fixed");
    }
    const items = [{ name: "w", unitPriceCents: 999, quantity: 2 }];
    const got = mod.bulkDiscountCents(items, 2, 50);
    if (got !== 999) throw new Error(`bulkDiscountCents([...], 2, 50) returned ${got}, expected 999`);
  });
}

console.log(JSON.stringify({ ok: checks.every((c) => c.ok), checks }));
process.exitCode = 0; // Structured result carries pass/fail; exit 0 means "verifier ran".
