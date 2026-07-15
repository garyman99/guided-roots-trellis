/**
 * Type-aware ESLint-as-a-service for Code Studio.
 *
 * Monaco (apps/web/src/desktop/CodeStudio.tsx) debounces edits and POSTs
 * {path, content} to /api/sessions/:id/lint (apps/api/src/server.ts), which
 * calls lintSource() here and hands the markers straight back. Type-aware
 * rules (the whole point — @typescript-eslint/no-floating-promises catching
 * a missing `await`) need a real TypeScript Program, which needs real files
 * on disk, so this module keeps a small persistent scratch project under
 * os.tmpdir() and writes each lint request's content into it before running
 * ESLint programmatically.
 *
 * The scratch project is seeded with the SAME curated @playwright/test
 * ambient types Monaco uses client-side (packages/lab-types/playwright.d.ts)
 * so `import { test, expect } from "@playwright/test"` resolves here too —
 * one source of truth, no drift between what the editor and the linter know.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESLint } from "eslint";

// The scratch project dir (below) lives outside this repo's node_modules
// tree, so a bare `import "typescript-eslint"` written into its generated
// eslint.config.mjs would fail to resolve. Resolve it once, here, from a
// location that DOES see the repo's node_modules, and embed the resolved
// absolute file:// URL in the generated config instead.
const require = createRequire(import.meta.url);
const TSESLINT_ENTRY = pathToFileURL(require.resolve("typescript-eslint")).href;

export interface LintMessage {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: 1 | 2;
  message: string;
  ruleId: string | null;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LINTABLE = /\.(mjs|cjs|jsx?|tsx?)$/;
const MAX_BYTES = 256 * 1024;

let warnedOnce = false;
function warnOnce(err: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn("[trellis-api] lintSource: internal error (further errors in this process are suppressed):", err);
}

// ── one-time scratch project setup ──────────────────────────────────────────

let projectDirPromise: Promise<string> | null = null;

/** Lazily creates (once per process) the on-disk project ESLint's type-aware
 *  program lints against: a tsconfig, the shared Playwright ambient types
 *  wired up as the real @playwright/test package, and a flat ESLint config. */
function ensureProjectDir(): Promise<string> {
  if (!projectDirPromise) {
    projectDirPromise = Promise.resolve().then(() => {
      const dir = join(tmpdir(), "trellis-eslint");
      mkdirSync(dir, { recursive: true });

      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2020",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              allowJs: true,
              checkJs: false,
              strict: false,
              noEmit: true,
              lib: ["ES2020", "DOM", "DOM.Iterable"],
              types: [],
            },
            include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
          },
          null,
          2,
        ),
      );

      const pwDir = join(dir, "node_modules", "@playwright", "test");
      mkdirSync(pwDir, { recursive: true });
      writeFileSync(join(pwDir, "package.json"), JSON.stringify({ name: "@playwright/test", version: "1.0.0", types: "index.d.ts" }, null, 2));
      const playwrightDts = readFileSync(join(repoRoot, "packages", "lab-types", "playwright.d.ts"), "utf8");
      writeFileSync(join(pwDir, "index.d.ts"), playwrightDts);

      // .mjs (not .js): the scratch dir has no package.json "type" field, so a
      // plain .js file here would load as CommonJS and choke on `import` —
      // .mjs forces ESM regardless, which is what typescript-eslint's flat
      // config helper expects.
      writeFileSync(
        join(dir, "eslint.config.mjs"),
        `import tseslint from ${JSON.stringify(TSESLINT_ENTRY)};

export default tseslint.config(
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: ${JSON.stringify(dir)},
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "no-unused-vars": "off",
      eqeqeq: "warn",
    },
  },
);
`,
      );

      return dir;
    });
  }
  return projectDirPromise;
}

// ── request serialization ────────────────────────────────────────────────────
// Concurrent lint calls must not race on the shared scratch file: chain every
// call onto the previous one so writes + lints run strictly one at a time.
let mutex: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutex.then(fn, fn);
  mutex = run.catch(() => {});
  return run;
}

/** Sanitizes an incoming workspace path down to a safe flat basename,
 *  preserving the extension so ESLint's per-file-glob resolution still works. */
function safeBasename(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "file.ts";
}

/**
 * Lints `content` as if it were the workspace file at `path`. Never throws:
 * on any internal failure this logs once and resolves to an empty result, so
 * a lint hiccup never surfaces as a broken editor.
 */
export async function lintSource(path: string, content: string): Promise<LintMessage[]> {
  if (!LINTABLE.test(path)) return [];
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) return [];

  try {
    return await serialize(async () => {
      const dir = await ensureProjectDir();
      const filePath = join(dir, safeBasename(path));
      writeFileSync(filePath, content);

      const eslint = new ESLint({
        cwd: dir,
        overrideConfigFile: join(dir, "eslint.config.mjs"),
      });
      const results = await eslint.lintFiles([filePath]);
      const messages = results[0]?.messages ?? [];
      return messages.map(
        (m): LintMessage => ({
          line: m.line,
          column: m.column,
          endLine: m.endLine ?? m.line,
          endColumn: m.endColumn ?? m.column,
          severity: m.severity === 2 ? 2 : 1,
          message: m.message,
          ruleId: m.ruleId ?? null,
        }),
      );
    });
  } catch (err) {
    warnOnce(err);
    return [];
  }
}
