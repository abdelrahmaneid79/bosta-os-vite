# BostaOS — Backend Handoff for the Design Phase

**Status: backend functionally complete and verified.** Build green, `tsc` clean,
137 automated harness checks passing, real‑data settlement reconciliation at 1.5%.
Design work can proceed against a stable, complete backend surface.

This document is what the design phase needs: the callable surface, the invariants
the UI must not break, what's wired vs. URL‑reachable, and the open (non‑blocking)
items.

---

## 1. Verified backend surface (what the UI can call)

### Data readers (`src/lib/data/*` — read-only, server)
- **Dashboard:** `getCommandCenter`, `getRevenueSummary`, `getSettlementSummary`, `getMoneyStory`
- **Sales:** `getDailySales`, `getSaleDetail`, `getMonthlyRevenue`
- **Inventory/Products:** `getProducts`, `getProductUsage`, `getCountHistory`, `countStatus`
- **Purchases:** `getPurchaseInvoices`
- **Expenses:** `getExpenses`, `getExpenseSummaries`, `getExpenseCategories`, `getExpenseFormOptions`
- **Settlement:** `getSettlementPeriods`, `getSettlementDetail`, `getLivePeriodIds`
- **Treasury:** `getPrimaryAccount`, `getCashMovements`, `getCashSummary`, `getCheques`, `getChequesForPeriod`, `chequeReceivedTotal`
- **Reports:** `getReports`, `getReportTable` (+ CSV export route)
- **Trust/health:** `runDataValidation`, `getMissingData`, `getHealthScore`, `getSystemCheck`, `buildInsights`
- **History:** `getSettlementMonths`, `buildHistoricalSettlementReconstruction`
- **Payroll (new):** `getEmployees`, `getEmployeeCompensation`, `getMonthlyPayrollTotal`
- **Alerts (new):** `getAlerts`
- **Profit integrity (new):** `getRentDoubleCounts`, `getSettlementFallbackPeriods`
- **Settings:** `getOperationalTrackingStartDate`, `getInventoryTrackingStartDate`, `getBusinessTermsOverview`, `getLocationTerms`

### Server actions (writes)
- **Sales:** `upsertDailySale`, `voidSale`, `deleteSale`, item create/update/delete
- **Purchases:** `createPurchase` (zero‑cost blocked), `voidPurchaseBatch`
- **Expenses:** `createExpense`, `updateExpense`, `voidExpense`
- **Inventory:** `createProduct`, `updateProduct`, `archiveProduct`, `deleteProduct` (history‑guarded), `recordMovement`, `recordPhysicalCount`, `voidPhysicalCount`, `reconcileProduct`
- **Cash:** `createMovement`, `recordWithdrawal`, `voidMovement`, **`recordCashCount`** (new)
- **Settlement:** **`updateDeduction` / `addDeduction` / `voidDeduction`** (new)
- **Cheques:** `createCheque`, `updateCheque`, `deleteCheque` (soft‑void), `restoreCheque`, **`transitionCheque`** (new)
- **Payroll (new):** `createEmployee`, `updateEmployee`, `archiveEmployee`, `setCompensation`, `postSalary`
- **Imports:** the import center + `voidImport` (audit‑safe; opt‑in daily‑sales reversal)
- **Settings:** locations, terms, suppliers, categories, reconciliation, inventory start date

---

## 2. Routes

Main nav (locked 8‑item set — do not expand without an explicit decision):
Dashboard · Sales · Products · Inventory · Purchases · Expenses · Cash & Cheques · Reports.

New surfaces this phase (reachable by URL + linked from **Settings → Operations**):
- `/payroll` — employees, salaries, post salary
- `/alerts` — time‑sensitive alerts
- `/money/rent-cleanup` — rent double‑count cleanup

Wired into existing pages: cash count (`/money/cash`), deduction editor + cheque
transition (`/money/settlements/[id]`).

---

## 3. Invariants the UI MUST preserve (non‑negotiable)

1. **Flow separation:** Revenue → Settlement → Cheque → Cash are independent. Profit
   = Revenue − COGS − operating expenses, computed independently. Never merge them.
2. **One continuous sales history.** Do NOT exclude imported/historical sales from
   revenue, trends, product history, or long‑term reports. Use three explicit lenses:
   full history (no filter), live‑operational (`sale_date >= operational tracking
   start`, a DATE — never the `is_historical` flag), and reliability
   (`verification_status`: verified/partially_verified/unverified/estimated).
3. **Operational tracking start date** governs missing‑day alerts, reconciliation,
   COGS/inventory, health. Before it's set, operational alerts stay quiet.
4. **Nothing hardcoded:** rent and revenue‑share come from effective‑dated
   `location_terms`. (A built‑in 15000/3% fallback fires only when terms are missing —
   surfaced by the `settlement-fallback-terms` check; the UI should push the owner to
   set real terms, never present the fallback as truth.)
5. **Profit hides, never lies:** when COGS is incomplete, profit is `null` — show the
   "needs full product cost" state, don't fabricate a number.
6. **Soft‑void everywhere:** voids set `voided_at`/`void_reason`; never hard‑delete
   financial records. Counts go through `record_physical_count` only.
7. **The settlement/WAC/money engine is frozen** (DB triggers + RPCs). UI composes
   readers/actions; it never recomputes settlement, WAC, or balances itself.

---

## 4. Activation steps still owned by the operator (not code)

- **Apply `supabase/migrations/0011_audit_log.sql`** (Dashboard SQL editor) + `npm run
  types:gen` — activates the audit log (the `logAudit` helper is a safe no‑op until then).
- **Verify `0001_base_schema.sql` vs production** once (RECOVERY.md §2). Behaviorally
  matched (engine 85/85), byte‑diff pending.
- **Set the operational tracking start date** and **cover every active month with
  `location_terms`** (else the fallback fires).
- **Run the rent double‑count cleanup** (`/money/rent-cleanup`) — real data has ~105k
  EGP of rent booked as expense AND deducted at settlement.

---

## 5. Known limitations (non‑blocking, for design awareness)

- Payroll/alerts/audit‑log are backend‑complete; their pages are functional but
  unstyled — design owns the visual layer.
- `import_rows` lacks created‑record ids → `voidImport` record reversal is opt‑in /
  imprecise for overlapping ranges.
- Single‑location settlement (`resolvePrimaryLocation` picks the busiest location).
- Smart Insights are deterministic; the LLM advisor is deferred.
- 2 validation detectors remain genuinely undetectable from stored data (cheque photo
  confidence, failed‑import tracking).

---

## 6. Regression safety net

Pure‑logic + real‑data harness in `../harness/` (outside the app):
- `sim.mjs` (85) — WAC/COGS/inventory/settlement/cash/counts/reconstruction
- `n1n4.mjs` (12) — continuous‑history lens model
- `phase3.mjs` (9) — production settlement engine scenarios
- `phase4.mjs` (12) — cash reconciliation + deduction adjustment
- `phase5.mjs` (19) — payroll/cheque‑lifecycle/alerts/profit‑integrity
- `recon-real.mjs` — real Bosta Bites files → 1.5% settlement reconciliation

Run any after a change: `node <file>.mjs`. Keep them green.
