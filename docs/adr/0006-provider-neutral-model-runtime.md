# ADR-0006: Provider-neutral model runtime — evidence policy and adapter strategy

Status: accepted · 2026-07-13 · Follows ADR-0005. Decisions made while
starting Phase 2 of the provider-neutral foundation
(`docs/plans/provider-neutral-foundation.md`, derived from the external
"Trellis System Design" doc and a verified current-state map).

## D38 — Manifests and reports are committed; raw evidence is referenced, not committed

Every simulation/evaluation/experiment run gets an immutable run ID, a run
manifest, and per-invocation usage records. What goes in git and what
doesn't:

- **Committed:** run manifests, human-readable evaluation and experiment
  reports, experiment definitions, and baseline snapshots — the auditable
  spine, under `scenarios/runs/…` and `scenarios/experiments/…`,
  append-only. A report must summarize enough concrete evidence that
  variants can be compared without opening the raw bundle.
- **Not committed:** full evidence bundles — traces, screenshots, DOM
  snapshots, transcripts, webm. Locally they live in the git-ignored
  `artifacts/` directory (recordings keep `scenarios/recordings/`); in CI
  they become immutable uploaded artifacts or object-storage objects with
  a retention policy.
- **The manifest is the join:** each evidence item is referenced with a
  content hash (sha256), artifact/schema version, logical path or
  artifact URI, redaction status, and retention status; the manifest also
  records every product/scenario/persona/prompt/model/configuration
  version needed to identify the run. Losing the raw bundle degrades an
  audit; it never orphans one.
- **Fixtures are the deliberate exception:** a small, curated, sanitized
  set of evidence bundles is committed under `fixtures/evidence-bundles/`
  as test inputs for evaluator parsing, report generation, schema
  migration, and example A/B comparisons. They are immutable fixtures
  with a README, not run artifacts, and are never updated by runs.

## D39 — Fetch-based adapters over a shared transport; SDKs are a future decision, not a ban

Provider adapters (Anthropic, OpenAI-compatible/local) are implemented on
native `fetch` with zero runtime dependencies, preserving the repo-wide
zero-dep convention and keeping vendor SDK types out of Trellis domain
interfaces — which also keeps local OpenAI-compatible endpoints
first-class. Shared HTTP concerns are centralized in ONE internal
transport module (`packages/model-runtime/src/transport.ts`, Phase 3)
rather than duplicated per adapter: cancellation/timeouts, bounded
retries, status and error normalization, request IDs, safe logging (never
prompt bodies or keys), usage extraction, and streaming-ready response
handling.

This is explicitly **not** a permanent "never use a provider SDK" rule.
Adopt an SDK later when it provides a specific correctness or capability
benefit that the transport would otherwise have to re-implement poorly —
e.g. complex streaming tool calls or provider-specific structured-output
behavior. That adoption is a new numbered ADR decision with the benefit
named, not a silent dependency add.

## D40 — One model-runtime package owns telemetry truth for all three roles

`packages/model-runtime` is the shared foundation under the Guide,
simulator, and evaluator roles: normalized usage
(`NormalizedModelUsage` — raw provider usage kept separately, never
fabricated), `ModelInvocationRecord`s, immutable run IDs and manifests
(D38 shapes), configuration-driven cost estimation
(`pricing.json`, versioned because provider pricing changes; unknown
model → cost `undefined`, never guessed), and the prompt registry (stable
ID + explicit version + sha256 for every model-facing prompt, including
the simulator contracts still living under `.claude/skills/`). Role
interfaces stay separate per the design doc's warning against one
over-generic interface; they share this substrate. The existing
`token_usage` store/admin path is untouched — invocation records are an
additive, append-only JSONL stream per run.
