# BostaOS — Reverse-Engineering Dossier & Rebuild Plan
_Forensic analysis of the Next.js handoff → design for a significantly better BostaOS._
_Grounded in: full source read (18k LOC), 3 subsystem deep-dives, live Supabase inspection (project `vvswohkqypzjtmfnpmba`), SCOPE.md, FINAL_VERIFICATION.md, STABILITY_SPRINT_REPORT._

---

## PHASE 1 — FORENSIC AUDIT

### 1. Done well
- **The financial engine is real and verified.** WAC, inventory ledger, settlement, cash signs, profit-hides-never-lies, reconstruction — 133/133 tests, reconciles to the cent. This is the crown jewel.
- **Inventory as an append-only ledger** (`inventory_movements`) with `current_stock`/`avg_cost` as trigger-maintained caches. Correct by construction; can't drift.
- **Revenue is canonical and never double-counted** — sums `sales.total_amount` (POS daily header); `sale_items` are breakdown/COGS only.
- **Imports never auto-save** — strict preview→approve, with a post-write `verifiedInDb` re-read proving the rows landed.
- **Import parsers are dynamic** — content-based date-column detection + synonym priority (fixed the Zoho 10.1× overstatement); Arabic normalization; alias learning.
- **Profit integrity** — `getCostConfidence` returns `profit: null` when any `cogs_at_sale` is missing; UI shows "—", never a fabricated number.
- **Single validation source** — `runDataValidation()` feeds health/insights/missing/dashboard.

### 2. Done poorly
- **51 routes / page-prison.** Money has cash+cheques+settlements nested 3 deep; duplicate `/settlements` and `/money/settlements`, `/stock` and `/inventory`, `/sales/import` and `/imports`. Navigation sprawl.
- **Calculation reads scattered across 30 `lib/data/*` files** with overlapping responsibilities (dashboard vs command-center vs action-center vs alerts vs analytics all re-aggregate).
- **No charting library** — hand-rolled SVG; SCOPE Feature 2 (interactive charts) is unmet.
- **Server-actions-everywhere** couples mutations to Next; every write is a form action with `revalidatePath`.
- **Owner-language leaks** (deduction/void/movement/source_type) repeatedly patched, not designed out.

### 3. Overengineered
- **Parallel double-entry General Ledger (0014: `gl_accounts/gl_entries/gl_lines`)** — built, balance-constrained, immutable… and **not wired to anything** ("awaiting future integration"). 11 seed accounts, 0 entries. Pure maintenance surface for a single sweets stall.
- **Period-close + accounting_periods + audit_immutability** — real accounting machinery; valuable but heavyweight for one owner; partially guards (locks inserts, not deduction/cheque edits).
- **Employee/compensation/payroll tables** — 0 rows, full module for (currently) no staff records.
- **`daily_snapshots`** — caching layer that adds a staleness vector.

### 4. Underengineered
- **No DB uniqueness on `sales(location_id, sale_date)`** — "one canonical sale/day" is app-code only → concurrent/import collisions double-count revenue **and** settlement. (Highest-impact open risk.)
- **Retroactive COGS staleness** — a backdated purchase recomputes `avg_cost` but does **not** re-snapshot `cogs_at_sale` on past sales → reported profit diverges from the ledger.
- **No tolerance band on settlement/cheque/cash** (sales has one) → a 0.10 EGP rounding gap reads as "not settled."
- **Import atomicity** — `runDailyImport` writes sales before the audit header; cash-count writes recon row before the balancing adjustment → orphans on partial failure.
- **Timezone** — UTC day boundaries surprise Egypt-local users near midnight.

### 5. Valuable business rules (preserve exactly)
- Revenue = Σ `sales.total_amount` where `voided_at is null`; lines never summed into revenue.
- WAC: `((qty·avg)+(newQty·newCost))/(qty+newQty)`; **Approach B** re-base to incoming cost when running qty ≤ 0; caches only via `recompute_product_costs`.
- `cogs_at_sale` snapshot at post time; never silently re-snapshotted.
- Profit = revenue − Σ cogs_at_sale − (cash_expense + salary). **Withdrawals excluded** from profit, included in cash.
- Cash signs: inflow + (cheque_inflow, owner_injection); outflow − (personal_withdrawal, cash_expense, salary); adjustment by direction.
- Settlement: `net_expected = round(accumulated_revenue − rent − rate·revenue, 2)`; rent **flat** (default 15000), rate **3%**, never prorated; auto-created idempotently; manual_override locks.
- Reconciliation tolerance = `max(5 EGP, 0.5%·total)`.
- Cheque "received" = status ∈ {received, deposited, cleared, reconciled} with amount+date present.
- Reconstruction: dynamic lag 0–30d (min MAE), `worst()` confidence ladder, `coverage.salesNoCheque` surfaces unfunded months.

### 6. Missing business rules
- POS **cash sales never post to the cash account** (no code path) → expected-cash is structurally incomplete.
- No **per-period re-cost / COGS-repair** action for backdated cost changes.
- No **multi-channel same-date** policy (historical preview keys by date, `runDailyImport` differs).
- Rent double-count detection is **English-regex only** (misses Arabic إيجار/ايجار).
- `total_cost` (invoice discounts) stored but **WAC uses `unit_cost` only** → basis can diverge from invoice.

### 7. Valuable workflows
- Screenshot/file import → preview → edit → approve → `verifiedInDb`.
- Missing-Data Center as a single data-quality cockpit (every gap → a fix with a route).
- Health score from real signals + trust gating (caps scores when data unreliable).
- Reconstruction of historical settlement from cheque photos + daily sales.

### 8. Workflows to redesign
- **Money** (cash/cheques/settlements split across ~8 routes) → one "Money" surface with tabs + detail drawers.
- **Stock vs Inventory vs Products** triple → one "Stock" surface (catalog · positions · counts · profitability as views).
- **Add flows** → one global Quick-Add command center (sale, screenshot, purchase, expense, cash, cheque) reachable everywhere.
- **Settings sprawl** (8 sub-pages) → one Settings with sections.

### 9. Useful DB structures (keep)
`products`, `sales`+`sale_items`, `inventory_movements`, `purchase_batches`, `money_accounts`+`money_movements`, `settlement_periods`+`settlement_deductions`, `cheques`, `location_terms`, `product_aliases`, `imports`+`import_rows`, `physical_counts`, `expense_categories`+`expenses`, `app_settings`, `audit_log`. **All RLS-on, single-admin.**

### 10. DB structures to change/retire
- **Retire (archive) the parallel GL** (`gl_*`) until there's a real need — unwired.
- **Reconsider** `employees/employee_compensation` (0 rows) — fold into a lightweight payroll-as-expense unless staff tracking is needed.
- **Drop/》derive** `daily_snapshots` (recompute on read; small data).
- **Add** `unique index sales(location_id, sale_date) where voided_at is null` (after a dup sweep).
- **Add** tolerance columns/settings for settlement & cheque reconciliation.
- **Fix DR gap**: base schema (0001–0011) isn't in `supabase_migrations` history — capture an authoritative dump.
- **Confirm** `product_aliases` real column shape (0001 `alias` vs 0009 `alias_text`).

### 11. Proven calculations to keep verbatim
WAC + Approach-B, profit `null` semantics, cash sign tests, cheque match (±0.50 EGP / ±2 days), settlement `net_expected`, reconciliation `max(5,0.5%)`, period leap-year handling, reconstruction lag/confidence. **These have tests — do not reimplement from scratch.**

### 12. Calculations to simplify
- Collapse the 5+ overlapping dashboard/command/action/alerts aggregators into **one read model**.
- One **facts pack** builder feeding health + insights + AI (today they each re-query).
- Settlement reconciliation should reuse the **sales tolerance** band (consistency).

### 13. Bugs & lessons (from the reports)
- **CRITICAL fixed:** purchase import dropped the blank-header date column (0 imported) and bill-total shadowed item-total (10.1× overstatement). Lesson: **content-based detection + synonym priority**, always.
- **P1 open:** duplicate day-sales (no unique index); retroactive-COGS staleness.
- **P1 fixed (untested):** cheque `reconciled` could save NULL amount/date; `voidSale/deleteSale` ignored RPC errors.
- **Security:** 0012 hardened 2 security-definer views + 23 function search_paths; 31 `using(true)` RLS = by-design single-admin (accepted); enable leaked-password protection (1 click).
- **Ops:** middleware `getUser()` per request hit auth 429 under rapid navigation.
- **Reality:** the live DB is **empty** — the "572 sales / EGP 2,685,749" lives only in the import files, not the DB.

---

## PHASE 2 — KNOWLEDGE REPORT (constants preserved)

**Revenue** Σ `sales.total_amount` (voided_at null). Lines = breakdown/COGS only.
**WAC** `((q·avg)+(nq·nc))/(q+nq)`; if pre-inflow `q≤0` → `avg=nc`; caches via `recompute_product_costs`; `cogs_at_sale` snapshot, never silent re-snap.
**Profit** `rev − Σcogs_at_sale − (cash_expense+salary)`; **null if any cogs missing**; withdrawals excluded.
**Cash signs** in:+(cheque_inflow, owner_injection); out:−(personal_withdrawal, cash_expense, salary); adjustment by direction; `recalc_money_account` ordered `(movement_date, created_at, id)` (0016 tiebreaker).
**Settlement** `net_expected = round(rev − rent − rate·rev, 2)`; rent flat **15000**, rate **0.03**, not prorated; idempotent auto-create; manual_override locks.
**Cheque** statuses {expected,pending,received,deposited,cleared,reconciled,cancelled}; RECEIVED={received,deposited,cleared,reconciled}; received needs amount+date.
**Reconciliation tol** `max(5, 0.005·total)`. **Count tol** 2% minor / 20% major. **Cheque match** ±0.50 EGP & ±2 days. **Fuzzy product** token-Jaccard ≥0.6. **Date-col detect** ≥60% cells parse as dates. **Excel serial** 40000–80000. **Lag** 0–30d. **Window** ≤45d.
**Confidence→verification** verified→verified; likely→partially_verified; estimated→estimated; conflict→never written. Dedup exact-key (natural) vs fuzzy-key; in-file idempotent; commit-only writes "new".
**Health weights** revenue .20, profit .20, inventory .12, cash .12, settlement .12, dataTrust .12, expenses .06, stockCoverage .06; tone ≥75 good / ≥50 ok / <50 bad; profit margin bands 0/10/25%; expense ratio bands 20/35/50%; trust gates cap scores.
**Insights** deterministic rules (sales pace ±10/25%, margin Δ≥3%, withdrawals>profit critical, expense ratio ≥30/50%, dead stock 30d, coverage <40/70%). AI narrates the facts pack only.

_(Full per-subsystem extraction with line references retained in the agent transcripts; the constants above are the load-bearing ones.)_

---

## PHASE 3 — REINVENT (first principles)

**Thesis:** the **Postgres engine is the brain and stays**; the **Next.js shell is baggage and goes**. BostaOS v2 = a fast Vite command center over the *existing, verified* Supabase backend, calling its proven RPCs for writes and reading clean view-models for display.

**Operating model — 4 questions, 1 surface each:**
- **What happened / is happening?** → **Today** (command center): revenue, profit (or "—"), cash, owed, stock alerts, trend chart.
- **What needs attention?** → **Missing/Health** merged into an **Attention** rail (critical→important→recommended), every item links to its fix.
- **What should I do next?** → **Quick-Add** everywhere (sale, screenshot, purchase, expense, cash, cheque) + AI "what to fix" narration over the facts pack.
- **Deep dives** → **Sales · Stock · Money · Reports** (each one surface with tabbed views + detail drawers, not nested routes).

**UX model:** mobile-first command center; ~7 primary destinations; detail in drawers/sheets (no page-prison); owner language only; advanced one tap down; never blocks the daily job.

---

## PHASE 4 — VITE ARCHITECTURE

**Stack:** Vite + React + TS + Tailwind + React Router + **TanStack Query** + **Zod** + **Recharts** + Supabase-js. **Edge Functions** for net-new server work (screenshot OCR vision, AI narration) since there are no Next API routes.

**Principle:** components display + dispatch; **read-models** (typed queries) and **RPCs** (proven mutations) are the only data surface; the **engine lives in Postgres**.

```
src/
  app/            App, router, providers (QueryClient, Auth)
  core/
    db/           supabase client, generated database.types.ts, rpc wrappers, query fns
    engine/       THIN typed wrappers over DB RPCs + pure display calcs (facts pack, formatting)
    types/        domain view-models
    validation/   zod (mirrors the proven import/sale/expense rules)
  read/           one read-model per surface (today, sales, stock, money, reports, attention)
  features/       today · sales · stock · money · reports · attention · imports · settings
  components/     ui · forms · charts · layout · feedback
```

**Why keep the engine in DB:** 133 passing SQL/TS tests encode the math; re-deriving in TS risks regression on real money. Vite's "no server" limitation is irrelevant — the server logic is Postgres functions/triggers, callable with the anon key under RLS.

---

## PHASE 5 — CHALLENGES TO PRIOR ASSUMPTIONS

1. **Don't port the Next app — keep only the DB.** The frontend is fully disposable; the backend is the asset. (Aligns with SCOPE "engine frozen; UI rebuild.")
2. **Retire the parallel General Ledger** until a concrete need exists. It's unwired complexity. Keep the *operational* ledgers (inventory/money movements) which are the real truth.
3. **Collapse 51 routes → ~7 surfaces + drawers.** Merge stock/inventory/products and the money trio; kill duplicate routes.
4. **One read model, not five aggregators.** Build a single facts pack; health/insights/AI/attention all consume it.
5. **Fix the two correctness gaps before real data lands:** add the `sales(location_id, sale_date)` unique index (post dup-sweep) and an explicit **Re-cost period** action for retroactive COGS.
6. **Switch day boundaries to Africa/Cairo.** (Business-clock correctness.)
7. **Make POS cash sales optionally post to cash** so expected-cash is complete (owner toggle).
8. **Reconciliation consistency:** settlement/cheque use the same tolerance philosophy as sales.
9. **Payroll-as-expense** unless staff records are actually needed; defer the employee tables.

---

## PHASE 6 — PRODUCT DECISIONS (as owner)

**Remove/defer:** parallel GL UI, payroll module, daily_snapshots, route duplicates, jargon surfaces.
**Add:** real interactive charts (Recharts) with filters+compare (SCOPE F2); screenshot→sale vision import (SCOPE F1); AI "what happened/why/what to fix" over the facts pack with graceful no-key degradation (SCOPE F3); a global Quick-Add; an Attention inbox.
**Automate:** alias auto-learn (exists) surfaced; settlement auto-create; recost prompt when a backdated purchase is detected; "missing sales day" nudges.
**QoL/owner:** EGP-first formatting, Arabic product names, "profit shows — not a lie," one-tap daily close, offline-tolerant Quick-Add.
**Mobile:** bottom nav + thumb-reachable Quick-Add; sheets over modals; big tap targets.
**Reporting:** CSV-first export (exists) + filtered charts + product/expense/settlement/inventory/P&L; comparison periods.
**Imports:** keep the verified pipeline; add screenshot vision; surface confidence + dedup + verifiedInDb proof.
**AI:** facts-only contract, cite every number, cache briefings, degrade to deterministic insights without a key.

---

## PHASE 7 — BUILD STRATEGY

**Backend:** reuse the existing Supabase project + verified schema **unchanged** (additive only). No destructive migrations. Two *additive, approval-gated* migrations queued: (a) unique day-sale index after a dup sweep; (b) recost RPC + tolerance settings. Generate `database.types.ts` from live.

**Frontend:** brand-new Vite app at repo root (the current `src/` v2 scaffold — shell, brand, UI kit — is **adapted**, its simplified domain model **replaced** by the real schema/RPC layer).

**Risks & mitigations**
- _Regressing verified math_ → don't reimplement; call RPCs; port the TS tests.
- _Building on empty DB_ → seed from the real import files (572 sales) into a **branch/dev** DB first.
- _Writing to live prod_ → gate behind explicit owner go; use a Supabase **branch** for build/test.
- _Auth 429 from per-request getUser_ → client session in SPA avoids middleware-per-request.
- _RLS using(true)_ → accepted (single-admin); optionally scope later.

**Build order**
1. Generate types; Supabase client + auth + protected shell (adapt v2 shell).
2. Read-model + RPC wrappers + zod; port the engine tests.
3. **Stock** (products/positions/WAC/counts) — foundational for COGS.
4. **Sales** (daily header + lines + reconcile + void/edit via RPC, stock-safe).
5. **Purchases** (batches → inventory in → WAC).
6. **Money** (cash ledger, cheques, settlements) one surface.
7. **Today** command center + Recharts trend.
8. **Attention** (health + missing + insights from one facts pack).
9. **Imports** (reuse pipeline; then screenshot vision Edge Function).
10. **Reports** + **AI narration** Edge Function.
11. Harden: the two additive migrations, leaked-password toggle, DR dump.

_Objective: extract the wisdom (verified Postgres engine + proven constants), discard the baggage (Next shell, route sprawl, unwired GL), ship a fast owner-first command center._

---

## LOCKED DECISIONS (owner-confirmed)
1. **Backend = reuse the verified engine, retire dead parts.** Keep the Supabase schema + proven RPCs/triggers untouched; the Vite app calls them. Archive the unwired General Ledger (`gl_*`), the dormant payroll tables, and `daily_snapshots` via **additive, approval-gated** migrations only (no drops without explicit go).
2. **Build/test on a Supabase BRANCH** (dev DB) seeded from the real import files (572 sales / EGP 2,685,749). Production project `vvswohkqypzjtmfnpmba` is read-only until promotion. Branch creation is billable → confirm cost first.
3. **Business clock = Africa/Cairo** for all day/month boundaries (today, this-month, missing-days, cash close).

### Engine RPC surface to wrap (typed, from migrations)
- `ensure_monthly_settlement_period(p_location_id uuid, p_month date) → uuid`
- `create_purchase(p_supplier_id, p_invoice_ref, p_purchase_date, p_location_id, p_source_type, p_verification, …lines)` 
- `create_sale_item / update_sale_item / delete_sale_item(...)`, `void_sale_movements(p_sale_id)`
- `recompute_product_costs(p_product_id)` / `recompute_product_stock(p_product_id)`
- `recalc_money_account(p_account_id)` (0016 tiebreaker)
Exact arg/return types to be taken from `generate_typescript_types` (Functions section) into `src/core/db/database.types.ts`.

### First implementation step (next)
1. Confirm branch cost → create branch → seed real import files into it.
2. `generate_typescript_types` (branch) → `src/core/db/database.types.ts`.
3. Africa/Cairo date core + typed RPC wrappers + read-models.
4. Adapt the v2 shell; build **Stock → Sales → Purchases → Money → Today → Attention → Imports → Reports/AI** in dependency order.
5. Port the engine tests; add the two additive fixes (unique day-sale index post dup-sweep; recost-period RPC).
