# BostaOS — Financial Logic (single source of truth)

_Updated 2026-07-13. Every number the app (and the AI strategist) shows traces to one of these._

## Canon
| Metric | Canonical home | Tested by |
|---|---|---|
| Revenue | `sales.total_amount`, voided excluded — `core/read/sales.ts` (paged) | day-sales tests, financial-contracts |
| Product lines | `sale_items` (breakdown + COGS only, never summed into revenue) | product-lines tests |
| COGS | **frozen** `sale_items.cogs_at_sale`, snapshotted at sale time from WAC else reference_cost (SQL 0007/0019). Later/backdated purchases fix FUTURE sales only | financial-contracts (WAC mirror) |
| Weighted avg cost | SQL `recompute_product_costs` (0006): full-ledger chronological replay; `unit_cost NULL` inflows are cost-neutral; clamp-to-zero rebase | financial-contracts |
| Profit | `core/read/profit.ts` — coverage-aware (see below) | profit-coverage.test, logic.test |
| Operating expenses | `expenses` where category `is_operating`; **withdrawals are never expenses** (typed `personal_withdrawal`, invariant-tested) | logic.test, financial-contracts |
| Cash position | `core/read/money.ts getCashPosition`: opening anchor + movements + cheques − expenses − purchases (paged) | ⚠ untested I/O — Cycle 2 adds coverage with the snapshot work |
| Expected cheque | SQL `recalc_settlement_period` (0001, era-dated terms via `location_terms`) + empirical cross-check `cheque-cycle.ts` | financial-contracts, cheque-cycle.test |
| Health score | pure `composeHealth` (`core/read/health.ts`) | logic.test |

## The coverage-aware profit contract (fixed 2026-07-13)
Most of history has day totals without product lines, so revenue can exist with no COGS.
`getProfitReadout` now returns:
- `coveredRevenue` — revenue on days with ≥1 mapped line (COGS measurable)
- `uncoveredRevenue` — revenue on header-only days = **unknown-COGS exposure** (was silently treated as pure profit)
- `margin` — gross margin % **on covered revenue only**
- `grossProfit`/`netProfit` — whole-range values, `null` unless coverage is complete AND no line lacks cost
- `complete` — `missingCostLines === 0 && uncoveredRevenue < 1`

Rule: **"hides, never lies"** — a number is either real or explicitly withheld with the reason quantified.

## Duplicate-day protection (3 layers)
1. Partial unique index `uq_sales_active_day` on (location_id, sale_date) where voided_at is null (0031, race-proof).
2. `createSale` check-then-insert friendly error.
3. Import brains dedupe against existing days/fingerprints.

## Reversibility
Everything money-touching is a soft void (`voided_at`/`void_reason`): sales, **sale lines (0032 — was a hard delete)**, expenses, movements, cheques, **purchases (voidPurchase — newly wired)**. Voided rows are excluded from every read (verified in audit).

## Known divergences (deliberate, labeled)
- Dashboard "latest reporting month" ≠ calendar month (sales data can lag); the compared month is now named in the label.
- `analytics` weekday averages include zero days; the forecast drops them (forecast wants trading behavior).
- "Awaiting cheque (gross)" is pre-deduction; the estimated net (blended deduction) is shown beside it.
