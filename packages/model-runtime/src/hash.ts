/** Content hashing for prompt artifacts and evidence references (ADR-0006). */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
