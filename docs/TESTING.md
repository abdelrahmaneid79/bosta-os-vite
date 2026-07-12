# BostaOS — Testing

_Updated 2026-07-13 (replaces the 2026-06 checklist — superseded sections live in git history)._

## Gates (all must pass before push)
```bash
npm run typecheck   # tsc -b (strict, noUnusedLocals)
npm run test        # vitest — 243 tests / 20 files
npm run build       # tsc -b && vite build
```
(`lint` was removed — eslint was never installed/configured; typecheck is the gate.)

## What's covered
- **Money math contracts**: `financial-contracts.test.ts` mirrors the SQL WAC replay + settlement recalc exactly (never-prorated rent, 3%-of-gross, clamp-to-zero, void exclusion).
- **Profit**: `profit-coverage.test.ts` — coverage-aware contract (header-only days, covered margin, back-compat); `logic.test.ts` — composeProfit basics, withdrawals-never-expenses invariant.
- **Cash scoring**: `scoreCashAccuracy` (expected ≤ 0 flattery regression).
- **Imports**: day-sales dedupe/attach/duplicate-block; product-line parse/classify/dedupe; seed fingerprints; CSV column detection.
- **Engines**: health composition, alerts, budgets, forecast, cheque cycle, product match/advice/profit, retail calendar.
- **Mutations**: createSale duplicate guard, movement signs, withdrawal typing.
- **Strategist engine** (`strategist-engine.test.ts`, 21 tests): scenario suite (revenue-up-margin-down, profit-up-cash-low, high withdrawals, stock risk on top seller, overdue cheques, missing COGS, expense spike, insufficient history, stale books, uncovered revenue, settlement lag, steady state) + contract honesty (missing ≠ zero, coverage→confidence, withdrawals outside opex, cash/profit source separation, deterministic ranking).

## Not covered (accepted, documented)
- Supabase-bound read fetchers (thin query wrappers) — including `getCashPosition` composition (Cycle 2 adds tests alongside the snapshot rebuild).
- UI components — no component-test harness; the manual QA checklist covers flows.

## Manual QA
Settings → **QA checklist** (`/qa`, now reachable from nav) — interactive checklist updated 2026-07-13 to match real screen names and flows. DB-level verification queries live in `supabase/tests/`.

## Strategist evals (Cycle 5)
Scenario suite: revenue-up-margin-down, profit-up-cash-down, high withdrawals, missing COGS, low stock on fast seller, overdue cheque, expense spike, insufficient history, unsupported question, risky withdrawal. Each asserts: no invented numbers, correct issue ranking, a concrete action, stated confidence, explicit missing-data disclosure, a working screen link, no generic advice. Spec in AI_STRATEGIST_SPEC.md.
