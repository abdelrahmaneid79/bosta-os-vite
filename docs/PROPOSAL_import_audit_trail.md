# Proposal — Import audit trail (no migration needed for Phase 1)

## Problem
CSV import (`ImportsScreen`) currently writes `sales` / `expenses` directly in a
loop and reports only `imported / skipped / failed` counts. There is **no record
of the import batch**: you can't see what file was imported, when, which rows were
created, which were skipped as duplicates, or which failed and why. There's also
no way to void a whole import.

## Good news: the tables already exist
The verified schema already ships two tables with exactly the right shape — so
**Phase 1 requires no migration**, only new INSERTs:

- `imports` — one row per batch: `filename, kind, location_id, period_from,
  period_to, row_count, source_type, verification, status, totals (jsonb),
  voided_at, void_reason`.
- `import_rows` — one row per source line: `import_id, row_index, raw (jsonb),
  parsed (jsonb), target, match_status, matched_product_id, applied,
  error_message`.

## Phase 1 — record every import (audit only, non-destructive)
On **Approve**:
1. Insert an `imports` header → `{ filename, kind: "sales"|"expenses",
   location_id, period_from/to (min/max parsed date), row_count, source_type:
   "import", verification: "verified", status: "processing" }`; keep its `id`.
2. For each parsed row, insert an `import_rows` row with `raw`, `parsed`,
   `target`, `row_index`, and an initial `match_status`
   ("ready" | "duplicate" | "blocked").
3. Create the `sale` / `expense` as today; then update that `import_rows` row to
   `applied = true` (or `applied = false, error_message = <reason>` on failure /
   `match_status = "duplicate"` when skipped).
4. Update the `imports` header → `status: "applied"`, `totals: { imported,
   skipped, failed }`.

**Safety:** the audit writes are *best-effort* — if logging fails it must not
block the real import (wrap in try/catch, surface a warning). No existing data is
touched; only new rows are added. A new read-model `getImports()` powers an
"Import history" list on the Imports screen, and these batches also feed the
existing Activity feed.

## Phase 2 — void an import (needs approval; small migration)
To void a whole batch and reverse its created records, `sales` and `expenses`
need a link back to the import. Options:
- **Preferred:** reuse existing generic reference columns if present
  (`sales.source_*` / a reference pair) — needs verification of exact columns.
- **Otherwise:** add a nullable `import_id uuid references imports(id)` to `sales`
  and `expenses`. This is an **additive, non-destructive** migration but still
  requires your approval before applying.

Void flow: set `imports.voided_at + void_reason`, then soft-void each linked
`sale` / `expense` via the existing void mutations (which already reverse stock /
recalc). Fully reversible, no hard deletes.

## Recommendation
Ship **Phase 1 next cycle** (pure additive INSERTs, no migration, immediate audit
value). Defer **Phase 2** until we confirm whether a reference column already
exists or you approve adding `import_id`. No destructive change is proposed.
