/**
 * Screen driver seam + recorder client + action executor (plan Phase 5).
 *
 * `SimScreenDriver` is what the loop needs from a browser; the recorder
 * implementation speaks the sim-driver HTTP protocol. Note what is ABSENT:
 * there is no eval here at all — the simulator-side client physically lacks
 * the privileged surface (ADR-0006 boundary; the driver additionally
 * enforces it with the coordinator token).
 */
import type { RawSnapshot } from "./observation.ts";
import type { SimulatorAction, TargetRef } from "./actions.ts";

export interface SimScreenDriver {
  snapshot(): Promise<RawSnapshot>;
  click(x: number, y: number): Promise<void>;
  dblclick(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
  replaceText(text: string): Promise<void>;
  scroll(dy: number): Promise<void>;
  wait(ms: number): Promise<void>;
}

export class RecorderDriverClient implements SimScreenDriver {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(port: number, fetchImpl: typeof fetch = fetch) {
    this.base = `http://127.0.0.1:${port}`;
    this.fetchImpl = fetchImpl;
  }

  private async post<T = Record<string, unknown>>(cmd: string, body: unknown = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.base}/${cmd}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as T & { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) throw new Error(`driver ${cmd} failed: ${json.error ?? res.status}`);
    return json;
  }

  async snapshot(): Promise<RawSnapshot> {
    const { url, title, text, targets } = await this.post<RawSnapshot>("snapshot");
    return { url, title, text, targets };
  }
  async click(x: number, y: number) { await this.post("click", { x, y }); }
  async dblclick(x: number, y: number) { await this.post("dblclick", { x, y }); }
  async type(text: string) { await this.post("type", { text }); }
  async press(key: string) { await this.post("press", { key }); }
  async replaceText(text: string) { await this.post("selectAllAndType", { text }); }
  async scroll(dy: number) { await this.post("scroll", { dy }); }
  async wait(ms: number) { await this.post("wait", { ms }); }
}

/**
 * Resolve a target reference against the CURRENT raw snapshot. Names match
 * case-insensitively: exact first, then unique substring; ambiguity and
 * misses are invalid actions (reported back to the model, never guessed).
 */
export function resolveTarget(raw: RawSnapshot, ref: TargetRef): { x: number; y: number } | { error: string } {
  if (ref.kind === "index") {
    const t = raw.targets[ref.value];
    if (!t) return { error: `target index ${ref.value} out of range (0..${raw.targets.length - 1})` };
    return { x: t.x, y: t.y };
  }
  const want = ref.value.trim().toLowerCase();
  const exact = raw.targets.filter((t) => t.name.trim().toLowerCase() === want);
  if (exact.length === 1) return { x: exact[0].x, y: exact[0].y };
  if (exact.length > 1) return { error: `target name "${ref.value}" is ambiguous (${exact.length} matches) — use an index` };
  const partial = raw.targets.filter((t) => t.name.toLowerCase().includes(want));
  if (partial.length === 1) return { x: partial[0].x, y: partial[0].y };
  if (partial.length > 1) return { error: `target name "${ref.value}" matches ${partial.length} elements — use an index` };
  return { error: `no visible target named "${ref.value}" — re-read the screen` };
}

export async function executeAction(
  driver: SimScreenDriver,
  raw: RawSnapshot,
  action: SimulatorAction,
): Promise<{ ok: true } | { ok: false; error: string }> {
  switch (action.type) {
    case "click":
    case "dblclick": {
      const at = resolveTarget(raw, action.target);
      if ("error" in at) return { ok: false, error: at.error };
      await (action.type === "click" ? driver.click(at.x, at.y) : driver.dblclick(at.x, at.y));
      return { ok: true };
    }
    case "type":
      await driver.type(action.text);
      return { ok: true };
    case "press":
      await driver.press(action.key);
      return { ok: true };
    case "replace-text":
      await driver.replaceText(action.text);
      return { ok: true };
    case "scroll":
      await driver.scroll(action.dy);
      return { ok: true };
    case "wait":
      await driver.wait(action.ms);
      return { ok: true };
  }
}
