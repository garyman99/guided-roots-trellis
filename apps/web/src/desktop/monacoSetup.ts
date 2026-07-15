/**
 * Monaco editor — one-time global setup.
 *
 * Importing this module wires the worker environment, TypeScript/JavaScript
 * language defaults (with a hand-authored @playwright/test ambient module so
 * lesson code autocompletes and type-checks), and a theme matched to the
 * desktop's dark chrome. Import it for its side effects before any editor
 * instance is created — CodeStudio does this at module scope.
 */
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import PLAYWRIGHT_DTS from "../../../../packages/lab-types/playwright.d.ts?raw";

export { monaco };
export const THEME = "trellis-dark";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === "typescript" || label === "javascript") return new TsWorker();
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    return new EditorWorker();
  },
};

const compilerOptions: monaco.languages.typescript.CompilerOptions = {
  target: monaco.languages.typescript.ScriptTarget.ES2020,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  allowJs: true,
  checkJs: false,
  strict: false,
  noEmit: true,
  lib: ["es2020", "dom", "dom.iterable"],
};

const diagnosticsOptions: monaco.languages.typescript.DiagnosticsOptions = {
  noSemanticValidation: false,
  noSyntaxValidation: false,
};

// PLAYWRIGHT_DTS (imported above) is a curated ambient declaration for
// @playwright/test — not the full real types, just enough of the API the
// labs' Playwright tests use (test/expect, Page, Locator, and the async
// matchers seen in web tests) so imports resolve and completions/diagnostics
// are useful. It lives at packages/lab-types/playwright.d.ts, shared with the
// server-side lint service (apps/api/src/lint.ts) so both sides see the same
// Playwright surface — no drift between "what Monaco knows" and "what the
// linter's type-aware program knows".

for (const defaults of [monaco.languages.typescript.typescriptDefaults, monaco.languages.typescript.javascriptDefaults]) {
  defaults.setCompilerOptions(compilerOptions);
  defaults.setDiagnosticsOptions(diagnosticsOptions);
  defaults.setEagerModelSync(true);
  defaults.addExtraLib(PLAYWRIGHT_DTS, "file:///node_modules/@playwright/test/index.d.ts");
}

monaco.editor.defineTheme(THEME, {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6a9955", fontStyle: "italic" },
    { token: "string", foreground: "ce9178" },
    { token: "keyword", foreground: "569cd6" },
    { token: "number", foreground: "b5cea8" },
  ],
  colors: {
    "editor.background": "#12161c",
    "editor.foreground": "#d7e0d9",
    "editorLineNumber.foreground": "#4c5a52",
    "editorLineNumber.activeForeground": "#9fb0a4",
    "editor.lineHighlightBackground": "#171c2380",
    "editor.lineHighlightBorder": "#00000000",
    "editorCursor.foreground": "#e5ede7",
    "editor.selectionBackground": "#7fb0694d",
    "editorGutter.background": "#12161c",
    "editorWidget.background": "#171c23",
    "editorWidget.border": "#30363d",
    "editorSuggestWidget.background": "#171c23",
    "editorSuggestWidget.border": "#30363d",
    "editorSuggestWidget.selectedBackground": "#232a33",
    "scrollbarSlider.background": "#30363d80",
    "scrollbarSlider.hoverBackground": "#30363dcc",
  },
});
