/**
 * Rubric extraction from scenario spec front-matter (plan Phase 4).
 *
 * The generator emits schema_version 1.1 specs in two YAML styles — inline
 * flow maps (`- { id: "x", weight: 30, … }`) and block lists (`- id: "x"` +
 * indented fields). This is a TARGETED extractor for the fields the
 * validator needs (dimension ids/weights, critical-failure ids/severities,
 * scoring thresholds), not a YAML parser; the full spec text still goes to
 * the model verbatim. Zero-dep by repo convention.
 */

export interface RubricDimension {
  id: string;
  weight: number;
}

export interface RubricCriticalFailure {
  id: string;
  severity: string;
}

export interface SpecRubric {
  scenarioId: string;
  dimensions: RubricDimension[];
  criticalFailures: RubricCriticalFailure[];
  scoring: {
    scale: number;
    exceptionalThreshold: number;
    passingThreshold: number;
    completionGateRequired: boolean;
  };
}

/** Collect the raw text of each `- …` item in a YAML list starting after `key:`. */
function listItems(lines: string[], startIdx: number, keyIndent: number): string[] {
  const items: string[] = [];
  let current: string[] | null = null;
  let itemIndent: number | null = null; // indent of the list's own `- ` items
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= keyIndent) break; // dedent = list over
    const isDash = line.trimStart().startsWith("- ");
    if (isDash && itemIndent === null) itemIndent = indent;
    if (isDash && indent === itemIndent) {
      // A `- ` at the list's own indent starts a new item; deeper dashes are
      // nested lists (e.g. a dimension's exceptional/acceptable anchors).
      if (current) items.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) items.push(current.join("\n"));
  return items;
}

function findKey(lines: string[], key: string): { idx: number; indent: number; rest: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^(\\s*)${key}:\\s*(.*)$`));
    if (m) return { idx: i, indent: m[1].length, rest: m[2] };
  }
  return null;
}

const grab = (text: string, field: string): string | undefined =>
  text.match(new RegExp(`${field}:\\s*"([^"]*)"`))?.[1] ?? text.match(new RegExp(`${field}:\\s*([\\w./-]+)`))?.[1];

const grabNum = (text: string, field: string): number | undefined => {
  const raw = text.match(new RegExp(`${field}:\\s*(\\d+)`))?.[1];
  return raw === undefined ? undefined : Number(raw);
};

/** Split a single-line flow list `[{…}, {…}]` into item texts. */
const flowItems = (rest: string): string[] =>
  rest
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(/\}\s*,\s*\{/)
    .map((s) => s.replace(/^\{?/, "").replace(/\}?$/, ""))
    .filter((s) => s.trim() !== "");

export function parseSpecRubric(specMarkdown: string): SpecRubric {
  const fm = specMarkdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) throw new Error("spec has no front-matter block");
  const lines = fm[1].split("\n");

  const scenarioId = grab(fm[1], "scenario_id");
  if (!scenarioId) throw new Error("spec front-matter has no scenario_id");

  const dimsKey = findKey(lines, "quality_dimensions");
  if (!dimsKey) throw new Error("spec front-matter has no quality_dimensions");
  const dimTexts = dimsKey.rest.startsWith("[") ? flowItems(dimsKey.rest) : listItems(lines, dimsKey.idx, dimsKey.indent);
  const dimensions = dimTexts.map((t) => {
    const id = grab(t, "id");
    const weight = grabNum(t, "weight");
    if (!id || weight === undefined) throw new Error(`quality dimension missing id/weight in: ${t.slice(0, 80)}`);
    return { id, weight };
  });
  if (dimensions.length === 0) throw new Error("spec has zero quality dimensions");
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);

  const cfKey = findKey(lines, "critical_failures");
  const cfTexts = cfKey ? (cfKey.rest.startsWith("[") ? flowItems(cfKey.rest) : listItems(lines, cfKey.idx, cfKey.indent)) : [];
  const criticalFailures = cfTexts.map((t) => {
    const id = grab(t, "id");
    const severity = grab(t, "severity") ?? "major";
    if (!id) throw new Error(`critical failure missing id in: ${t.slice(0, 80)}`);
    return { id, severity };
  });

  const scoringKey = findKey(lines, "scoring");
  const scoringText = scoringKey
    ? scoringKey.rest.startsWith("{")
      ? scoringKey.rest
      : [scoringKey.rest, ...listItems(lines, scoringKey.idx, scoringKey.indent)].join("\n") ||
        lines.slice(scoringKey.idx, scoringKey.idx + 6).join("\n")
    : "";
  const scale = grabNum(scoringText, "scale") ?? 100;
  if (totalWeight !== scale) {
    throw new Error(`quality dimension weights sum to ${totalWeight}, expected scale ${scale}`);
  }
  return {
    scenarioId,
    dimensions,
    criticalFailures,
    scoring: {
      scale,
      exceptionalThreshold: grabNum(scoringText, "exceptional_threshold") ?? 92,
      passingThreshold: grabNum(scoringText, "passing_threshold") ?? 75,
      completionGateRequired: /completion_gate_required:\s*true/.test(scoringText),
    },
  };
}
