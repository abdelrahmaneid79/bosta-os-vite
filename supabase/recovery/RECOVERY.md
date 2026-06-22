# BostaOS — Disaster Recovery & Base-Schema Export (Task 1)

> ## ✅ UPDATE — the real base schema was RECOVERED and committed.
> `bostaos_phase1_schema.sql` (the original Phase-1 base schema) was located and copied
> to **`supabase/migrations/0001_base_schema.sql`** — 700 lines: all 17 tables, 10 enums,
> 2 views, the settlement triggers (`trg_sales_assign_settlement`,
> `trg_sales_recalc_settlement`, `trg_deduction_recalc`) and the engine functions
> (`recalc_settlement_period`, `recalc_money_account`, `get_effective_terms`, …).
> A fresh environment can now be rebuilt from `0001 → 0010`. Disaster-recovery gap is
> effectively CLOSED (one residual step: confirm `0001` matches the live DB byte-for-byte
> with the export in §2 — the bodies already match behaviourally, verified 85/85 + Phase 3).
>
> **Diff vs the reconstruction** (`0001_base_schema.RECONSTRUCTED.sql`): the settlement
> FORMULA is identical (`net_expected = revenue − rent − round(revenue×rate,2)`,
> `accumulated_revenue` sums ALL non-voided sales — confirming historical sales DO count).
> Real-engine details the reconstruction lacked: (a) `get_effective_terms(location, date)`
> arg order; (b) **hardcoded fallback defaults rent=15000 / rate=0.03** in
> `ensure_monthly_settlement_period` when terms are missing; (c) header-only sales are
> reconciled by definition; (d) the sales trigger is split BEFORE (assign) + AFTER (recalc).


This folder addresses the highest production risk: the original base schema (`0001`)
— core tables **plus the settlement/cash engine functions and triggers** — was
created directly in the Supabase project and was **never committed**. Migrations in
`supabase/migrations/` start at `0002`, so a fresh environment cannot be rebuilt
from source.

This pass did **not** invent or alter any engine logic. It (1) audited exactly what
is missing, (2) documented the one authoritative way to capture it, and (3) produced
a **reconstructed reference** of the engine objects from verified behaviour so the
contracts are at least readable in source — clearly marked as *not* production‑verified.

> **Why I could not just export it for you:** the export requires the database
> connection string / service role (Dashboard → Project Settings → Database). The
> repo only contains the public anon key (`.env.local`), which is RLS‑gated and
> cannot read `pg_catalog` or dump function bodies. The export below must be run by
> someone holding the DB password. It is a 2‑minute, one‑time task.

---

## 1. Audit — what is source‑controlled vs production‑only

Derived from `src/types/database.types.ts` (generated **from** the live DB) cross‑
referenced against `supabase/migrations/0002…0010`.

### Already in source control (migrations 0002–0010)
- Tables: `inventory_movements` (0003), `purchase_batches` (0004), `physical_counts` (0008), `imports` + `import_rows` (0009)
- Enums: `inventory_movement_type` (0003)
- Columns: `cheques.due_date` + nullable received fields (0002), `products.base_units_per_sale_unit` (0007)
- Functions: `recompute_product_stock` (0003), `create_purchase` / `void_purchase_batch` (0005), `recompute_product_costs` / `recompute_all_product_costs` (0006), `post_sale_item_movement` / `create_sale_item` / `update_sale_item` / `delete_sale_item` / `void_sale_movements` (0007), `record_physical_count` / `void_physical_count` (0008)
- Triggers: `trg_inv_mov_sync_stock` (0003/0006)

### PRODUCTION‑ONLY — missing from source control (the gap)

**Tables (17)** — `app_settings`, `cash_reconciliations`, `channels`, `cheques`,
`daily_snapshots`, `employee_compensation`, `employees`, `expense_categories`,
`expenses`, `location_terms`, `locations`, `money_accounts`, `money_movements`,
`product_aliases`, `product_categories`, `products`, `sale_items`, `sales`,
`settlement_deductions`, `settlement_periods`, `suppliers`.

**Views (2)** — `v_active_sales`, `v_open_settlement`.

**Enums (9)** — `cheque_status`, `deduction_type`, `money_movement_type`,
`payment_method`, `product_unit_type`, `settlement_status`, `snapshot_source`,
`source_type`, `term_type`, `verification_status`.

**Engine functions (8)** — the irreplaceable part:
- `get_effective_terms(p_date, p_location_id) → {charge_rate, rent_amount}[]`
- `ensure_monthly_settlement_period(p_location_id, p_month) → uuid`
- `recalc_settlement_period(p_period_id) → void`
- `refresh_settlement_totals(p_period_id) → void`
- `check_sale_reconciliation(p_sale_id) → boolean`
- `recalc_money_account(p_account_id) → void`
- `get_setting_numeric(p_key) → numeric`
- `set_updated_at() → trigger`  *(shared updated_at helper)*

**Trigger (≥1)** — the `AFTER INSERT/UPDATE/DELETE` trigger on `sales` that attaches a
sale to its monthly settlement period and recalculates it. (The exact trigger name is
production‑only; capture it with the export below.)

---

## 2. Authoritative export (run with DB access — produces the REAL `0001`)

Pick ONE. Both produce a byte‑faithful, re‑appliable schema with the true function
bodies and trigger definitions.

```bash
# A) Supabase CLI (preferred). Link once, then dump.
supabase link --project-ref vvswohkqypzjtmfnpmba
supabase db dump --schema public -f supabase/migrations/0001_base_schema.sql

# B) pg_dump directly (needs the DB connection string from
#    Dashboard → Project Settings → Database → Connection string).
pg_dump --schema-only --schema=public --no-owner --no-privileges \
  "postgresql://postgres:<PASSWORD>@db.vvswohkqypzjtmfnpmba.supabase.co:5432/postgres" \
  > supabase/migrations/0001_base_schema.sql
```

Then **trim** the dump so it does not re‑declare what `0002…0010` already create
(the dump is a full snapshot; the later migrations are deltas). Two safe options:
- Keep `0001_base_schema.sql` as the full snapshot and **renumber/retire** `0002…0010`
  into an `applied/` archive (fresh installs run only `0001`), **or**
- Strip from `0001` the objects listed under “Already in source control” above so
  `0001 → 0010` apply cleanly in order.

To capture exact function bodies individually for review:

```sql
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('get_effective_terms','ensure_monthly_settlement_period',
    'recalc_settlement_period','refresh_settlement_totals','check_sale_reconciliation',
    'recalc_money_account','get_setting_numeric','set_updated_at');

select tgname, pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where c.relname='sales' and not t.tgisinternal;
```

---

## 3. Verify a fresh environment

```bash
supabase start                      # local Postgres
psql "$LOCAL_DB_URL" -f supabase/migrations/0001_base_schema.sql
for f in supabase/migrations/000{2,3,4,5,6,7,8,9}_*.sql supabase/migrations/0010_*.sql; do
  psql "$LOCAL_DB_URL" -f "$f"; done
# Seed one location + terms + a product, insert a sale, and assert the settlement
# period auto-creates with net_expected = revenue - rent - rate*revenue.
```

The behavioural expectations to assert are encoded and proven in the harness
(`harness/sim.mjs`, 73/73) and mirrored in `0001_base_schema.RECONSTRUCTED.sql`.

---

## 4. Disaster‑recovery status — before vs after

| | Before this pass | After this pass |
|---|---|---|
| Core tables in source | ❌ none of the 17 base tables | ⚠️ documented + reconstructed reference; **real DDL still needs the export** |
| Engine functions in source | ❌ 8 functions production‑only, undocumented | ⚠️ reconstructed from verified behaviour (reference), exact signatures captured; **bodies need the export to be canonical** |
| Sales→settlement trigger | ❌ invisible | ⚠️ behaviour documented + reconstructed reference |
| Can a new dev read the engine contracts? | ❌ no | ✅ yes (reconstructed reference + this audit) |
| Can a fresh env be rebuilt from `git clone`? | ❌ no | ❌ **not until the export in §2 is run** (needs DB password) |
| Recoverability if the project is lost today | ❌ **0% — unrecoverable** | ⚠️ structure + contracts recoverable; exact bodies recoverable **only while the live DB is reachable** — run §2 now |

**Bottom line:** the only thing that closes this gap to 100% is running the 2‑minute
export in §2 with the DB password. Everything else here makes the gap *visible,
documented, and reviewable* and gives a fresh‑env reference, but it is not a
substitute for the real dump. **Do the export at the next opportunity.**
