// `npm run tour` — prints the bench's directory structure with a one-line note
// on what each piece is for. Orientation only: it changes nothing, it just
// helps you connect the file names to their jobs.
import { existsSync } from "node:fs";

// Curated map: path → what it's for. Kept in lesson order (site → test → run).
const MAP = [
  ["app/index.html", "the web page under test — open it in Garden Site, like a visitor"],
  ["tests/first.test.ts", "the Selenium test itself: open a browser, read the heading, check it"],
  ["scripts/test.mjs", "what `npm test` runs — it drives the test and reports pass/fail"],
  ["scripts/tour.mjs", "this tour (you're running it now)"],
  ["package.json", "the project's scripts (`test`, `tour`) and its Selenium dependencies"],
  ["tsconfig.json", "TypeScript settings, so the editor understands the test"],
  ["README.md", "your orientation: what Selenium is, and this same map in prose"],
];

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

console.log(bold("\nThe Selenium test bench\n"));
console.log("selenium-bench/");
for (const [path, note] of MAP) {
  const present = existsSync(path) ? "" : dim("  (missing — reset the lab to restore)");
  const pad = " ".repeat(Math.max(1, 26 - path.length));
  console.log(`  ${path}${pad}${dim("— " + note)}${present}`);
}
console.log(
  dim("\nThat's the whole bench. Next lesson you'll run the test and watch the browser work.\n"),
);
