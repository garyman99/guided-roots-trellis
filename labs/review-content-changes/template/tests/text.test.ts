import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, excerpt } from "../src/text.ts";

test("slugify collapses runs of punctuation and spaces into single hyphens", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("  One --- Two  "), "one-two");
});

test("slugify strips leading and trailing separators", () => {
  assert.equal(slugify("...Already-Slugged..."), "already-slugged");
});

test("excerpt returns short bodies untouched", () => {
  assert.equal(excerpt("just four small words", 10), "just four small words");
});

test("excerpt keeps exactly maxWords and marks the cut", () => {
  assert.equal(excerpt("one two three four five", 2), "one two…");
});
