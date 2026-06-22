# BostaOS Stability Sprint — Report
**Date:** 2026-06-21
**Mode:** Static correctness audit (the runtime sandbox was unavailable all session — see §6/§10).
**Codebase:** `C:\Users\abdel\BostaOS` (full Next.js 15 / React 19 / Supabase app, 16 SQL migrations).

> Honesty note up front: I could **not** run the app, lint, typecheck, build, or Playwright this session. The isolated Linux environment failed to start across ~12 attempts (`VM service not running. The service failed to start.`). Everything below is from **reading the code**. The two code fixes I applied are therefore **UNTESTED** and must be verified once the environment is back. Nothing was run, so no result here is a "passing test."

---

## 0. Environment / code-location finding (resolved)
- The Cowork folder `C:\Users\abdel\Claude\Projects\bostaOS` is **empty**.
- The **real, complete codebase already lives at `C:\Users\abdel\BostaOS`** — nothing is missing or lost. Earlier "no files" results were a glob bug caused by the `(app)` route-group folder name, not absent code.
- **Recommendation:** treat `C:\Users\abdel\BostaOS` as the single source of truth. Do **not** copy it into the empty folder — that would create a second, dependency-less copy and make it ambiguous which is canonical (a real hazard for financial code).

---

## 1. What I tested (audited)
Static trace of DB → calculation → UI across all Priority-1 financial domains:
- **Sales + Dashboard:** add/edit/delete/void, product-level lines, daily totals, verification/reconciliation, historical-vs-live separation, dashboard revenue.
- **Purchases + Inventory + Weighted-Average COGS:** purchase intake, WAC formula, inventory increase/deduction, sale-edit reversal, sale-delete restoration, missing-COGS, low-stock, inventory value.
- **Cash + Settlement + Cheques:** money-account ledger, expected/actual cash, differences, settlement period auto-creation, flat rent, 3% revenue charge, expected/actual cheque, reconciliation status.
- **Expenses + Imports + Reports + Alerts:** category/payment handling, withdrawal segregation, profit math, import preview/approval gate, duplicate prevention, historical tagging, alias memory, missing-data/alert logic.

Files read: the full `src/lib/data/*` calculation layer, all `src/app/(app)/*/actions.ts` mutation layer, the import library, and migrations `0001`–`0016` plus the SQL tests. (Coverage was done with four parallel sub-audits, then I independently re-read the top findings before confirming them.)

## 2. What was working (verified correct by reading code)
- **Revenue is canonical and never double-counted.** Every revenue read sums `sales.total_amount` (the POS daily total) and filters `voided_at is null`. Product-level `sale_items.line_total` is used only for breakdowns/COGS, never added to the revenue total.
- **Weighted-average COGS formula is exactly correct:** `((qty·avg)+(new_qty·new_cost))/(qty+new_qty)`, with division-by-zero structurally impossible (clamp-to-incoming-cost branch when running qty ≤ 0).
- **Inventory ledger is the single source of truth;** `current_stock`/`avg_cost` are caches recomputed by trigger on every movement. Add-purchase (+), sale (−), sale-edit (void-then-repost), sale-delete (void→replay), and void-day all post/void movements atomically via RPCs, guarded by a partial-unique index against double-deduction.
- **Rent is flat, never prorated** (default 15,000 EGP seeded once per period, idempotent re-runs). **3% revenue charge** is applied to the correct base (`accumulated_revenue = Σ sales.total_amount`). `net_expected = round(accumulated_revenue − Σ deductions, 2)`.
- **Cash ledger signs are correct** (inflows +, withdrawals/expenses/salary −) and covered by `cash-signs.test.ts`. `recalc_money_account` has a deterministic tiebreaker (migration 0016).
- **Personal withdrawals** are excluded from operating profit but included in cash flow — verified end-to-end, including the expense importer routing them to `money_movements` not `expenses`.
- **Settlement periods auto-create** idempotently (partial unique index + existence check).
- **Sale reconciliation tolerance** = `greatest(5 EGP, 0.5% × total)` with `abs(diff) ≤ tol`; header-only days reconciled by definition.
- **Imports never auto-save.** Every importer is gated on an explicit `commit:true`; preview returns a plan only. Historical rows tagged `is_historical/source_type/verification`. Alias-learning is idempotent. Unmatched products become `conflict` (never auto-created) and surface in the Missing center.

## 3. What was broken / risky (found, grouped by severity)
**P1 — financial correctness / data integrity**
1. **Cheque `reconciled` could be saved with NULL amount/date** while treasury counts it as "money arrived" → under-reports settlement "amount received." (cheques/actions.ts vs treasury.ts) — **FIXED (untested).**
2. **`voidSale`/`deleteSale` ignored the stock-restore RPC and settlement-void errors** and proceeded/redirected as success → on partial failure, orphaned inventory movements or a hard-deleted sale with stale settlement. (sales/actions.ts) — **FIXED (untested).**
3. **No DB uniqueness on `sales(location_id, sale_date)`** — the "one canonical sale per day" rule is app-code only (check-then-insert). Concurrent submit or manual+import collision can create duplicate day headers that double-count revenue and inflate settlement. — **DOCUMENTED, not auto-applied** (needs a unique index + a duplicate sweep first; could fail against existing data).
4. **Retroactive COGS staleness:** a **backdated purchase** (or sale edit after an oversell re-base) recomputes `avg_cost` correctly but does **not** re-snapshot `cogs_at_sale` on already-recorded sales → reported profit on historical sales becomes inconsistent with the ledger. — **DOCUMENTED** (design decision; risky to "fix" blind).
5. **`runProductImport` auto-creates products with no dedup/merge guard** and stores the Arabic POS string as the English name; re-running can create duplicate products. Other importers are safe — this one bypasses the shared dedup path. — **DOCUMENTED** (confirm if still wired in UI before changing).
6. **`runDailyImport` writes `sales` before its `imports` audit header** (best-effort) → a failed audit insert leaves orphaned, hard-to-reverse sales rows. — **DOCUMENTED** (needs transactional wrap).

**P2 — high**
- Cash-count writes the reconciliation row **before** the balancing adjustment, non-transactionally → orphan recon row if the month is period-locked or on retry.
- **Period lock doesn't guard `settlement_deductions` or `cheques`** → "closed" months' settlement figures remain editable.
- Cash-count expected-balance read is non-atomic (TOCTOU) → adjustment can over/under-correct under concurrency.
- Settlement/cheque/cash reconciliation has **no tolerance band** (unlike sales) → a 0.10 EGP rounding gap reads as "not settled." Confirm intended.
- `refresh_settlement_totals` (deduction trigger path) doesn't re-derive the 3% from current revenue → a stale charge can publish if revenue cache is mid-update.
- Several explicit-`total_cost` purchase entries (invoice discounts) are stored but **WAC uses `unit_cost` only** → costing basis can diverge from the invoice.

**P3 — lower / clarity**
- Dashboard "Sold today/this month" mixes back-dated historical imports with live data (divergent from the settlement side); UTC date boundary can surprise Egypt-local users near midnight.
- Rent double-count detection is English-regex only (misses Arabic "إيجار").
- Reports show two different "expenses" totals (operating vs all) with no reconciling note.
- Multi-channel same-date dedup is inconsistent between historical preview and `runDailyImport` (keys by date only).
- Migration `0009` may re-shape `product_aliases` columns onto the `0001` table (left both `alias_text` and `alias`).
- `getMonthlyRevenue` ignores its date filter (currently dead code).
- Gram-denominated `avg_cost` at 4dp can truncate per-gram precision at scale.

## 4. What I fixed (both UNTESTED — sandbox down)
1. **`src/app/(app)/money/cheques/actions.ts`** — added `reconciled` to `RECEIVED_STATUSES` so a cheque reaching the final stage must carry `amount_received` + `received_date`, matching what `treasury.ts` counts as received. Updated the two validation messages. (P1-1)
2. **`src/app/(app)/sales/actions.ts`** — `voidSale` and `deleteSale` now check the result of `void_sale_movements` and the soft-void update, and abort (redirect with an error) instead of silently continuing / hard-deleting on failure. Happy path unchanged. (P1-2)

I deliberately did **not** auto-apply the DB-level fixes (unique index, transactional wraps, COGS re-snapshot, importer rework) — they need a runtime + data check and could fail or corrupt data if applied blind. They are documented above and in §7.

## 5. What I did NOT touch
- No UI / visual / redesign work (per your rules).
- No database migrations created or run; no schema or data changed.
- No production/live data reset or modified.
- No business logic deleted.
- The P1-3/4/5/6 and all P2 items — documented, not changed, because they need runtime verification.

## 6. What is still risky
- The two applied fixes are **unverified** (no typecheck/build/test possible). They are low-risk and behavior-preserving, but should be linted/typechecked/tested before trusting.
- The unguarded duplicate-day-sale path (P1-3) and retroactive-COGS staleness (P1-4) are the highest-impact open risks to financial accuracy.
- Import atomicity gaps (P1-6, P2 cash-count) can leave orphaned rows on partial failure.

## 7. What needs manual review / decision
- **Product/data decisions:** Should POS cash sales flow into the cash account? (No code path does today.) Should settlement/cheque reconciliation use the same tolerance as sales? Is the business timezone UTC or Africa/Cairo? Should back-dated imports affect "Sold today/this month"?
- **Before applying P1-3:** run a duplicate sweep on `sales(location_id, sale_date)` then add `create unique index ... where voided_at is null`.
- **Confirm** whether `runProductImport` is still the live product path (vs `previewProductSalesImport`).
- **Confirm** `product_aliases` real column shape in the live DB (0001 vs 0009).

## 8. Files changed
- `src/app/(app)/money/cheques/actions.ts`
- `src/app/(app)/sales/actions.ts`
- (new) `STABILITY_SPRINT_REPORT_2026-06-21.md` (this report)

## 9. Database tables / functions changed
- **None.** No migrations written or run; no schema, function, trigger, or data changed.

## 10. Commands run
- File reads/searches across the repo (Read/Grep).
- Repeated sandbox attempts: `node --version`, `ls`, `unzip -l`, etc. — all returned `VM service not running. The service failed to start.`
- **No** `npm install` / `lint` / `typecheck` / `build` / `vitest` / Playwright could run.

## 11. Tests passed
- **None executed.** (Note: the repo ships `cash-signs.test.ts` and SQL tests for audit-immutability, general-ledger, and period-close — these were read but not run.)

## 12. Tests failed
- **None executed.** No fabricated results.

## 13. Screenshots / browser observations
- **None.** No app instance could be launched (no runtime).

## 14. Exact next prompt to paste (once the environment is back)
> The runtime environment is back. In C:\Users\abdel\BostaOS: run `npm install`, then `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test`. Report the real output. Then verify my two static fixes (cheques RECEIVED_STATUSES incl. `reconciled`, and sales void/delete error guards) compile and behave correctly. Next, write a failing-then-passing test for the duplicate daily-sale risk (P1-3) and for the retroactive-COGS staleness on a backdated purchase (P1-4), confirm they reproduce, then propose (do not auto-apply) the safest fix for each with a data-migration plan. Use Playwright to walk Add/Edit/Delete sale, Add purchase, Cash count, and a cheque reconcile, and capture screenshots.
