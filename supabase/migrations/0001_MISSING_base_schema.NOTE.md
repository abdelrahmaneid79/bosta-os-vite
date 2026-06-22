# ⚠️ Missing base schema `0001` — schema-export task (NOT a migration)

This file is a **developer note**, not a migration. It documents a known gap: the
original base schema (`0001`) was applied directly to the Supabase project and was
never committed to source control. Migrations in this folder start at `0002`.

## What lives in the un-versioned base schema
The settlement engine — created outside this repo — including:

- Core tables: `locations`, `location_terms`, `channels`, `sales`, `sale_items`,
  `settlement_periods`, `settlement_deductions`, `money_accounts`,
  `money_movements`, `cheques`, `products`, `product_categories`,
  `expense_categories`, `expenses`, `app_settings`, etc.
- The per-sale **settlement triggers** and functions:
  - `get_effective_terms(p_date, p_location_id)`
  - `ensure_monthly_settlement_period(...)`
  - `recalc_settlement_period(...)`
  - the AFTER INSERT/UPDATE/DELETE trigger on `sales` that accumulates revenue
    and seeds rent + revenue-share deductions.
- `check_sale_reconciliation`, `recalc_money_account`, and related helpers.

## Why this matters
These functions are the source of truth for **net_expected / accumulated_revenue**
and for keeping `settlement_periods` correct. They are correct in production but
**cannot be code-reviewed, diffed, or recreated** from this repo. A fresh
environment (or a disaster-recovery rebuild) would be missing them.

## The task (do when safe — does NOT block operational work)
Export the live schema into a real `0001_base_schema.sql` and commit it:

```bash
# requires the project's DB connection string / service access
supabase db dump --schema public > supabase/migrations/0001_base_schema.sql
# or via pg_dump:
pg_dump --schema-only --schema=public "$DATABASE_URL" > supabase/migrations/0001_base_schema.sql
```

Then verify it re-applies cleanly to a scratch database and that the settlement
trigger behaviour matches production.

## Rules
- **Do NOT rewrite or `CREATE OR REPLACE` these triggers blind.** Editing them
  without the real source risks breaking the live sale → settlement path.
- App-layer work that depends on settlement (e.g. historical-import term coverage)
  is handled defensively in code (`ensureTermsCoverage`) and must stay that way
  until `0001` is captured.
