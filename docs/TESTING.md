# BostaOS — Testing

_Updated 2026-07-13 (replaces the 2026-06 checklist — superseded sections live in git history)._

## Gates (all must pass before push)
```bash
npm run typecheck   # tsc -b (strict, noUnusedLocals)
npm run test        # vitest — 366 tests / 26 files
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
- **Strategist persistence/UI logic** (`strategist-persistence.test.ts`, 12 tests): insight lifecycle (insert/recur/reopen/auto-resolve/dismissed-stays-silent), action dedup, owner memory, suggested questions, withdrawal assessment (safe/tight/unsafe/unknowable), response validation incl. malformed-degrades-safely.
- **Strategist engine** (`strategist-engine.test.ts`, 21 tests): scenario suite (revenue-up-margin-down, profit-up-cash-low, high withdrawals, stock risk on top seller, overdue cheques, missing COGS, expense spike, insufficient history, stale books, uncovered revenue, settlement lag, steady state) + contract honesty (missing ≠ zero, coverage→confidence, withdrawals outside opex, cash/profit source separation, deterministic ranking).

## Not covered (accepted, documented)
- Supabase-bound read fetchers (thin query wrappers) — including `getCashPosition` composition (Cycle 2 adds tests alongside the snapshot rebuild).
- UI components — no component-test harness; the manual QA checklist covers flows.

## Manual QA
Settings → **QA checklist** (`/qa`, now reachable from nav) — interactive checklist updated 2026-07-13 to match real screen names and flows. DB-level verification queries live in `supabase/tests/`.

- **Cycle 8 activation** (`strategist-activation.test.ts`, 32 tests): activation checklist + readiness states, opening baseline (gap ≠ expense/loss/withdrawal), interval reconciliation (cheque ≠ drawer cash, unknown-payment lowers confidence), neutral difference classification, daily close (blocks complete when required missing, no-trading), sales-gap detection (recent-first, never zero), opening stock count (value-unknown for missing cost, NOT a purchase), count variance (unit-mismatch blocks, never theft), purchase quantities (reliable qty, count-first refusal, unaffordable, excess), planned-action amounts → obligations, live health (historical gaps don't tank live), missing-data grouping (Activate > Historical).
- **Cycle 7 cash intelligence** (`strategist-cash.test.ts`, 23 tests): obligation calendar (rent excluded as cheque-deducted), CashState (never-counted→null-not-zero, stale counts, reserve policies, cheques never available), withdrawal v2 (unknowable/illiquid-profitable/reserve-breach/prior-draws), affordability (employee revenue-to-cover with no assumed benefit, expected-cash Tune gate, mandatory-vs-optional), projection (relative mode, known-only zero sales, downside delay, breach day), runway (coverage months, downside flip, withdrawals excluded), cash priorities.
- **Cycle 6 product intelligence** (`strategist-cycle6.test.ts`, 31 tests): contribution (growth/decline/low-coverage-refusal/missing-cost exclusion/determinism), decomposition (volume/price/cost-led + refusals), classification (all tags, thresholds labeled, stock-risk gated on tracked inventory), shelf caveats, pricing (target price, no fabricated targets, price-drift flags, owner off-switch), purchasing (data-first when untracked, days-of-cover, excess stock), weekly priority (cash outranks pricing, suppression, queued-action awareness), outcomes (improved/worsened/awaiting-data/cancelled/no-re-eval).
- **Language layer** (`strategist-language.test.ts`, 15 tests): deterministic templates without credentials, fake-provider plug-in (proves provider independence), router fallback on throw/unavailable/invented-number/over-confidence/budget, grounding validator.
- **Strategy report** (`strategy-report.test.ts`, 10 tests): executive status transitions, confidence-ceiling degradation, persistence eligibility, price/employee/memory-override/settlement/cash-unavailable scenarios.

## Cycle 9 — production hardening (`strategist-cycle9.test.ts`, 43 tests)
Daily-close automation (auto-detect complete/blocked/confirm-required, product-line mismatch, pending-import block, no-trading, estimated, cash-count policy, COGS optional) + lifecycle (stale detection, complete/reopen/void transitions); canonical exception composition (stable ids, neutral cash language, missing-data/imports/obligations/actions mapping, dedup) + lifecycle reconciliation (new→open, resolved→reopened, dismissed-suppressed, materially-worse/critical reopen, auto-resolve); daily brief health verdicts; denomination counting (tally, mismatch-confirm, manual-only); outcome attribution (strong/moderate/weak/inconclusive) + execution summary; deterministic operational answers (intent routing + grounded replies); notification projection; idempotency duplicate detection. Suite total 409.

## Strategist evals (Cycle 5)
Scenario suite: revenue-up-margin-down, profit-up-cash-down, high withdrawals, missing COGS, low stock on fast seller, overdue cheque, expense spike, insufficient history, unsupported question, risky withdrawal. Each asserts: no invented numbers, correct issue ranking, a concrete action, stated confidence, explicit missing-data disclosure, a working screen link, no generic advice. Spec in AI_STRATEGIST_SPEC.md.
