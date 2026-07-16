/**
 * SessionManager resolves a lab id across two roots: repo labs first, then the
 * published (generated) labs directory. This is the runtime half of D2 — a
 * course-generation run publishes into curriculum/published/ and the lab is
 * immediately playable without a repo commit.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.ts";
import { SessionManager } from "../src/sessions.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("labDir searches repo labs first, then the published root", () => {
  const publishedRoot = mkdtempSync(join(tmpdir(), "trellis-published-"));
  // A generated lab that ships only in the published root.
  const genId = "gen-fake-lab";
  mkdirSync(join(publishedRoot, genId), { recursive: true });
  writeFileSync(
    join(publishedRoot, genId, "lab.json"),
    JSON.stringify({ id: genId, title: "Generated Fake Lab", objective: "x", scenario: "x", tasks: [], checkpoint: { id: "c", title: "c", requirements: [] } }),
  );

  const store = createStore();
  const manager = new SessionManager(store, join(repoRoot, "labs"), { publishedRoot });

  // Repo lab resolves to the repo root.
  const repoLab = manager.labDir("learn-playwright-basics");
  assert.ok(repoLab.includes(join("labs", "learn-playwright-basics")), "repo lab from labs/");

  // Generated lab resolves to the published root, and its manifest loads.
  assert.equal(manager.labDir(genId), join(publishedRoot, genId));
  assert.equal(manager.loadManifest(genId).title, "Generated Fake Lab");

  // Unknown and malformed ids still fail loudly.
  assert.throws(() => manager.labDir("nope-not-a-lab"), /unknown lab/);
  assert.throws(() => manager.labDir("Bad_Id"), /invalid lab id/);

  store.close();
});

test("without a published root, only repo labs resolve", () => {
  const store = createStore();
  const manager = new SessionManager(store, join(repoRoot, "labs"));
  assert.ok(manager.labDir("learn-playwright-basics").length > 0);
  assert.throws(() => manager.labDir("gen-fake-lab"), /unknown lab/);
  store.close();
});
