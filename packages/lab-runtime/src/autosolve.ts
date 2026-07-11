/**
 * CI auto-solve harness (Phase 4): every variant in a blueprint must be
 * provably (a) broken as shipped and (b) solvable by its authored solution,
 * or it cannot be released. Unsolvable variants become impossible to ship,
 * not incidents to apologize for.
 */
import type { LabDriver, LabDefinition, LabHandle } from "./driver.ts";
import { verifyScriptPathFor } from "./evaluator.ts";
import type { Blueprint } from "./variants.ts";

async function runVerifier(handle: LabHandle, labDir: string): Promise<boolean> {
  const { verifyScript } = verifyScriptPathFor("local", labDir);
  const res = await handle.exec(["node", verifyScript], { timeoutMs: 60_000 });
  // The verifier prints one structured JSON line; parse it, never scrape prose.
  const line = res.stdout.trim().split("\n").findLast((l) => l.startsWith("{"));
  if (!line) throw new Error(`verifier produced no JSON: ${res.stderr.slice(0, 200)}`);
  return (JSON.parse(line) as { ok: boolean }).ok === true;
}

export interface AutoSolveReport {
  defect: string;
  brokenAsShipped: boolean; // verifier fails before the solution runs
  solvable: boolean;        // verifier passes after the solution runs
  ok: boolean;
  detail?: string;
}

export async function autoSolveVariant(
  driver: LabDriver,
  def: LabDefinition,
  bp: Blueprint,
  defectId: string,
): Promise<AutoSolveReport> {
  const spec = bp.defects[defectId];
  if (!spec) return { defect: defectId, brokenAsShipped: false, solvable: false, ok: false, detail: "unknown defect" };
  const handle = await driver.create({ ...def, variant: { defect: defectId } }, `autosolve-${defectId}-${Date.now()}`);
  try {
    const brokenAsShipped = (await runVerifier(handle, def.labDir)) === false;

    const fix = await handle.exec(spec.solution, { timeoutMs: 30_000 });
    if (fix.exitCode !== 0) {
      return { defect: defectId, brokenAsShipped, solvable: false, ok: false, detail: `solution exited ${fix.exitCode}: ${fix.stderr.slice(0, 200)}` };
    }

    const solvable = await runVerifier(handle, def.labDir);
    return {
      defect: defectId,
      brokenAsShipped,
      solvable,
      ok: brokenAsShipped && solvable,
      detail: !brokenAsShipped ? "variant not broken as shipped" : !solvable ? "authored solution does not pass the verifier" : undefined,
    };
  } finally {
    await handle.destroy();
  }
}

export async function autoSolveAll(driver: LabDriver, def: LabDefinition, bp: Blueprint): Promise<AutoSolveReport[]> {
  const out: AutoSolveReport[] = [];
  for (const defectId of Object.keys(bp.defects)) out.push(await autoSolveVariant(driver, def, bp, defectId));
  return out;
}
