# Curated evidence-bundle fixtures (ADR-0006 D38)

Deliberately curated, sanitized evidence bundles committed as **test
fixtures** — NOT run artifacts. Their jobs, as phases land:

- evaluator bundle parsing (Phase 4)
- report generation (Phase 4/6)
- schema migration tests when artifact shapes version forward
- example baseline-vs-candidate A/B comparisons (Phase 6)

Rules:

1. **Immutable.** Runs never write here; the scenario routine never updates
   these. A fixture changes only by an explicit, reviewed commit (usually to
   add a new schema-version variant alongside the old one — keep both, that
   is what migration tests eat).
2. **Sanitized.** All content is synthetic (authored personas, `.example`
   addresses). Verify any new bundle contains no real PII, credentials, or
   tokens before committing it.
3. **Hand-picked, few.** One representative bundle per interesting shape —
   not an archive. Prefer editing a copy down to the minimum that still
   exercises the parser.

## Bundles

| Bundle | Source | Why it was picked |
|---|---|---|
| `improve-delayed-order-reply-iter7/` | `scenarios/runs/improve-delayed-order-reply/iter-7/` @ commit 1726f8f | The first ACCEPTED live workspace run (92/91 split across threshold, second-opinion evaluation present) — richest committed shape: session export with workspace events + context manifests, BEAT trace, completion gates, findings.yaml, two evaluations |
