/**
 * RunArtifacts — the on-disk artifact store for one generation run, rooted at
 * curriculum/runs/<runId>/. Content lives here (diffable, inspectable); run
 * STATE is indexed in SQLite but also mirrored here as run.json (see mirror.ts)
 * so a lost DB can be rebuilt from disk. Two guarantees the API relies on:
 *
 *   • Path allowlist — a write/read path must match the known run layout (plan
 *     §3) and may never escape the run directory. The API exposes artifact
 *     reads to the browser, so traversal defense is not optional.
 *   • Revisioning — re-writing an artifact after a changes-requested loop keeps
 *     the prior version as `<base>.v<N>.<ext>`, so the UI can diff revisions.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join, dirname, resolve, relative, extname, basename } from "node:path";

/** Allowlisted artifact paths for the run layout. Anchored, forward-slash. */
const ALLOW: RegExp[] = [
  /^course-request\.md$/,
  /^domain-map\.md$/,
  /^progression-spine\.md$/,
  /^prerequisite-graph\.json$/,
  /^course-conventions\.md$/,
  /^lesson-inventory\.(json|md)$/,
  /^plan-review\.md$/,
  /^capability-gaps\.(json|md)$/,
  // Scenario-grounded capability briefs — one markdown brief per gap id, authored
  // by the architect and used as the outbox request.md on commission (gap-reconciliation-pause §5).
  /^capability-briefs\/[a-z0-9-]+\.md$/,
  /^manifest\.json$/,
  /^run\.json$/,
  /^persona\.json$/,
  /^briefs\/[a-z0-9-]+\.json$/,
  /^lessons\/[a-z0-9-]+\/lesson\.md$/,
  /^lessons\/[a-z0-9-]+\/lab\/[A-Za-z0-9._\/-]+$/,
  /^reviews\/[a-z0-9-]+\.(technical\.md|pedagogy\.json|cohesion\.md)$/,
  // `blueprint.summary.json` is the blueprint panel's outcome ledger (the plan's
  // equivalent of reviews/summary.json). Its three verdict artifacts —
  // reviews/blueprint.{technical.md,pedagogy.json,cohesion.md} — already match
  // the per-subject rule above, since "blueprint" is a valid subject slug.
  /^reviews\/(course\.cohesion\.md|coverage-matrix\.md|quality-gates\.json|summary\.json|blueprint\.summary\.json)$/,
  /^critiques\/[a-z0-9-]+\.round([1-9]|10)\.json$/,
  /^critiques\/summary\.json$/,
  /^sim-tests\/[a-z0-9-]+\/(result\.json|simulator-trace\.md)$/,
  // The `rehearsing` phase's output (rehearsal-phase §4): a per-lesson sim
  // result + trace, plus the phase's roll-up. Distinct from `sim-tests/`, which
  // is the older post-publish advisory queue.
  /^rehearsal\/summary\.json$/,
  /^rehearsal\/[a-z0-9-]+\/(result\.json|simulator-trace\.md)$/,
  /^gates\/(frame|blueprint|reconcile|package|rehearse|publish)\.verdict\.json$/,
];

export function isAllowedArtifactPath(relPath: string): boolean {
  if (relPath.includes("\\")) return false; // callers use forward slashes
  if (relPath.includes("..") || relPath.startsWith("/")) return false;
  // Archived revisions (`foo.v2.md`) are legitimate reads — the diff UI needs
  // them — so validate the de-revisioned base against the allowlist too.
  const base = relPath.replace(/\.v\d+(\.[^./]+)$/, "$1");
  return ALLOW.some((re) => re.test(relPath) || re.test(base));
}

export interface WriteResult {
  path: string;
  /** 1 for the first write; N when the prior N-1 versions were archived. */
  revision: number;
}

export class RunArtifacts {
  private readonly runDir: string;
  constructor(runDir: string) {
    this.runDir = runDir;
  }

  private abs(relPath: string): string {
    const abs = resolve(this.runDir, relPath);
    // Defense in depth: even an allowlisted-looking path must stay inside.
    const rel = relative(this.runDir, abs);
    if (rel.startsWith("..") || resolve(rel) === rel) throw new Error(`artifact path escapes run dir: ${relPath}`);
    return abs;
  }

  exists(relPath: string): boolean {
    if (!isAllowedArtifactPath(relPath)) return false;
    return existsSync(this.abs(relPath));
  }

  read(relPath: string): string | null {
    if (!isAllowedArtifactPath(relPath)) throw new Error(`disallowed artifact path: ${relPath}`);
    const abs = this.abs(relPath);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  }

  /**
   * Write an artifact. If one already exists at this path, archive it as the
   * next `<base>.v<N>.<ext>` first, then write the new content. Returns the
   * revision number (1 = first write). Pass `archive: false` for ledger-style
   * artifacts rewritten many times per phase (e.g. reviews/summary.json after
   * every lesson) — the current file is overwritten in place, no revision kept.
   */
  write(relPath: string, content: string, opts: { archive?: boolean } = {}): WriteResult {
    if (!isAllowedArtifactPath(relPath)) throw new Error(`disallowed artifact path: ${relPath}`);
    const abs = this.abs(relPath);
    mkdirSync(dirname(abs), { recursive: true });

    let revision = 1;
    if (existsSync(abs) && opts.archive === false) {
      writeFileSync(abs, content);
      return { path: relPath, revision: this.revisions(relPath).length + 1 };
    }
    if (existsSync(abs)) {
      // The current file's ordinal = (archived count) + 1. Archive it under
      // that ordinal, so the new current becomes the next ordinal.
      const currentOrdinal = this.revisions(relPath).length + 1;
      renameSync(abs, this.abs(this.revisionPath(relPath, currentOrdinal)));
      revision = currentOrdinal + 1;
    }
    writeFileSync(abs, content);
    return { path: relPath, revision };
  }

  /** All archived revisions of a base artifact, oldest first (excludes current). */
  revisions(relPath: string): string[] {
    const abs = this.abs(relPath);
    const dir = dirname(abs);
    if (!existsSync(dir)) return [];
    const ext = extname(relPath);
    const base = basename(relPath, ext);
    const rel = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/") + 1) : "";
    return readdirSync(dir)
      .filter((f) => new RegExp(`^${escapeRe(base)}\\.v\\d+${escapeRe(ext)}$`).test(f))
      .sort((a, b) => revNum(a) - revNum(b))
      .map((f) => rel + f);
  }

  /** Every artifact path present, relative to the run dir (recursive). */
  list(): string[] {
    const out: string[] = [];
    const walk = (dir: string, prefix: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(dir, entry.name), rel);
        else out.push(rel);
      }
    };
    walk(this.runDir, "");
    return out.sort();
  }

  private revisionPath(relPath: string, n: number): string {
    const ext = extname(relPath);
    return relPath.slice(0, relPath.length - ext.length) + `.v${n}` + ext;
  }
}

function revNum(name: string): number {
  const m = name.match(/\.v(\d+)(?:\.[^.]+)?$/);
  return m ? Number(m[1]) : 0;
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
