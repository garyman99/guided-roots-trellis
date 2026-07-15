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

/**
 * A curated ambient declaration for @playwright/test — not the full real
 * types, just enough of the API the labs' Playwright tests use (test/expect,
 * Page, Locator, and the async matchers seen in web tests) so imports
 * resolve and completions/diagnostics are useful.
 */
const PLAYWRIGHT_DTS = `
declare module "@playwright/test" {
  export interface Locator {
    click(): Promise<void>;
    fill(value: string): Promise<void>;
    textContent(): Promise<string | null>;
    innerText(): Promise<string>;
    isVisible(): Promise<boolean>;
    count(): Promise<number>;
    first(): Locator;
    last(): Locator;
    nth(index: number): Locator;
    getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): Locator;
    getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
    getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator;
    getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator;
    getByTestId(testId: string): Locator;
    getByTitle(text: string | RegExp, options?: { exact?: boolean }): Locator;
    getByAltText(text: string | RegExp, options?: { exact?: boolean }): Locator;
    locator(selector: string): Locator;
  }

  export interface Page {
    goto(url: string): Promise<void>;
    getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): Locator;
    getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
    getByLabel(text: string | RegExp, options?: { exact?: boolean }): Locator;
    getByPlaceholder(text: string | RegExp, options?: { exact?: boolean }): Locator;
    getByTestId(testId: string): Locator;
    getByTitle(text: string | RegExp, options?: { exact?: boolean }): Locator;
    getByAltText(text: string | RegExp, options?: { exact?: boolean }): Locator;
    locator(selector: string): Locator;
    click(selector: string): Promise<void>;
    fill(selector: string, value: string): Promise<void>;
    title(): Promise<string>;
    content(): Promise<string>;
    waitForLoadState(state?: "load" | "domcontentloaded" | "networkidle"): Promise<void>;
    screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Buffer>;
  }

  export interface Matchers<T> {
    toBeVisible(): Promise<void>;
    toBeHidden(): Promise<void>;
    toBeChecked(): Promise<void>;
    toBeEnabled(): Promise<void>;
    toBeDisabled(): Promise<void>;
    toHaveText(expected: string | RegExp): Promise<void>;
    toContainText(expected: string | RegExp): Promise<void>;
    toHaveValue(expected: string | RegExp): Promise<void>;
    toHaveTitle(expected: string | RegExp): Promise<void>;
    toHaveURL(expected: string | RegExp): Promise<void>;
    toHaveCount(count: number): Promise<void>;
    toHaveAttribute(name: string, value: string | RegExp): Promise<void>;
    toBe(expected: T): void;
    toEqual(expected: T): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    not: Matchers<T>;
  }

  export function expect<T>(actual: T, message?: string): Matchers<T>;

  export interface TestArgs {
    page: Page;
  }

  export type TestBody = (args: TestArgs) => Promise<void> | void;

  export interface TestFunction {
    (title: string, body: TestBody): void;
    describe: {
      (title: string, body: () => void): void;
      skip: (title: string, body: () => void) => void;
      only: (title: string, body: () => void) => void;
    };
    beforeEach(body: TestBody | (() => Promise<void> | void)): void;
    afterEach(body: TestBody | (() => Promise<void> | void)): void;
    beforeAll(body: TestBody | (() => Promise<void> | void)): void;
    afterAll(body: TestBody | (() => Promise<void> | void)): void;
    skip(title: string, body: TestBody): void;
    only(title: string, body: TestBody): void;
    step<T>(title: string, body: () => Promise<T> | T): Promise<T>;
  }

  export const test: TestFunction;
}
`;

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
