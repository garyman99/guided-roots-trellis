// Deterministic behavioral verification for "review-content-changes".
// Runs INSIDE the lab workspace; prints one structured JSON line.
//
// UNIVERSAL across the defect library: any planted defect breaks one of the
// original behaviors; any correct fix restores them. The verifier never
// needs to know which defect was planted.
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
await check("module-loads", "src/text.ts loads without errors", async () => {
  mod = await import(new URL("src/text.ts", `file://${process.cwd()}/`).href);
});

if (mod) {
  await check("defect-fixed", "original text behaviors are restored (the planted defect is fixed)", () => {
    const slug = mod.slugify("Hello, World!");
    if (slug !== "hello-world") throw new Error(`slugify("Hello, World!") returned "${slug}", expected "hello-world"`);
    const ex = mod.excerpt("one two three four five", 2);
    if (ex !== "one two…") throw new Error(`excerpt(..., 2) returned "${ex}", expected "one two…"`);
    const whole = mod.excerpt("just four small words", 10);
    if (whole !== "just four small words") throw new Error(`excerpt left short bodies altered: "${whole}"`);
  });

  await check("feature-kept", "readingTimeMinutes still exists and works (fix was surgical, not a blanket revert)", () => {
    if (typeof mod.readingTimeMinutes !== "function") {
      throw new Error("readingTimeMinutes is missing — the new feature was removed instead of the defect being fixed");
    }
    const got = mod.readingTimeMinutes("word ".repeat(201));
    if (got !== 2) throw new Error(`readingTimeMinutes(201 words) returned ${got}, expected 2`);
    if (mod.readingTimeMinutes("tiny") !== 1) throw new Error("minimum reading time must be 1");
  });
}

console.log(JSON.stringify({ ok: checks.every((c) => c.ok), checks }));
process.exitCode = 0;
