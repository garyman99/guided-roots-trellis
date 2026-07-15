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
