/**
 * Text utilities for the demo blog engine.
 */

/**
 * Turns a post title into a URL slug: lowercase, runs of non-alphanumerics
 * collapse into single hyphens, no leading/trailing hyphens.
 */
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Returns the first `maxWords` words of a post body, with an ellipsis when
 * the body was actually cut. Whole bodies come back untouched.
 */
export function excerpt(body: string, maxWords: number): string {
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return body.trim();
  return words.slice(0, maxWords).join(" ") + "…";
}
