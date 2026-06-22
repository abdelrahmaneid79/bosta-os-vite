# BostaOS v2 — Local Testing Checklist (read-only)

Run locally (this sandbox can't reach `*.supabase.co`):
```
npm install
npm run typecheck     # tsc -b — must pass
npm run build         # must pass
npm run dev           # Vite → http://localhost:5173
```
`.env` must hold `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon = read-only, no cost).

## Auth / connection
- [ ] App shows the **Sign in** screen (not Setup) → `.env` is loaded.
- [ ] Sign in with your Supabase account → lands on **Today**.
- [ ] Wrong password shows a clear error; no crash.

## Design match (vs `design-reference`)
- [ ] Slim left rail: pink mascot square, central pink **+**, icon+label nav, Settings/System pinned bottom.
- [ ] Header: big Fredoka title, `Bosta Bites · <Month Year> · read-only`, search, avatar.
- [ ] Jet background with pink glow top-right; mint-green for "good", pink accents.
- [ ] Mobile (<768px): bottom scroll nav, single column, **+** in header.

## Read-only data (real numbers, no mock)
- [ ] **Today**: today/month revenue, stock value, cash, owed, attention list, health ring.
- [ ] **Goods**: products with on-hand, avg cost, stock value, low / no-COGS / negative badges.
- [ ] **Sales**: recent sales, totals exclude voided, reconciled vs mismatch dots.
- [ ] **Buy**: purchase batches, spend total, linked product names.
- [ ] **Cash**: balance, inflow/outflow, withdrawals shown separately; movements list.
- [ ] **Cheques**: settlement periods (net expected) + cheques (expected/received/diff).
- [ ] **Profit (P&L)**: revenue, COGS, gross profit — shows **"unknown"** (not 0) when costs incomplete.
- [ ] **Reports**: period tabs; CSV export downloads real stock + P&L.
- [ ] **Health**: big ring + status; **Level/streak from real data**; Helping/Hurting; category cards with reason + lift. Incomplete categories show "—", never a fake score.
- [ ] **Missing**: real gaps (missing COGS, unmapped lines, unreconciled, negative stock) with Review links.
- [ ] **System**: connection/auth/table-read checks pass under your session.

## Write gates (must NOT write)
- [ ] **+** opens Quick add sheet; every action is **disabled** with a "writes disabled" note.
- [ ] Quick actions on Today are disabled.
- [ ] No insert/update/delete/RPC fires anywhere (check Network tab — only GETs).

## Report back
Any RLS "permission denied" / empty tables / schema-mismatch errors, and any screen where the layout diverges from the design reference.

---

# Operational write tests (Phases 1–2) — run locally with Supabase

Capabilities: **enabled** = Goods, Purchases, Sales (create/add-line). **risky** (confirm) = edit/void sale line, void day. **not-built** = Expenses, Cash, Cheques, Imports, Settings.

## Goods
- [ ] Goods → **+ Product** → name + price → Save → appears in list; toast "Product added".
- [ ] Tap a product → edit price/active → Save → updates.

## Purchases (proves stock-in + WAC)
- [ ] Buy → **+ Purchase** → product, qty (base units), unit cost → Save → toast "stock & cost updated".
- [ ] Goods: that product's **on-hand increases**, weighted cost shows, "no COGS" badge clears.

## Sales (proves deduction + COGS + reversal)
- [ ] Sales → **+ Sale** → date + day total → Save → appears in Recent sales.
- [ ] Tap the sale → **+ Add product line** → product + qty + price → Save → toast "stock deducted".
- [ ] Goods: that product's **on-hand decreases** by the qty.
- [ ] Sale detail: line shows COGS captured (no "no COGS" if the product had cost).
- [ ] **Edit line** (✎) → change qty → Save → stock reverses old, applies new (net change only).
- [ ] **Void line** (✕) → confirm → stock restored; line removed.
- [ ] **Void whole day** → confirm → day voided, all its movements reversed, revenue drops.
- [ ] Profit (P&L): updates; shows **"unknown"** if any sold line lacks cost.

## Safety
- [ ] Voids require a confirmation dialog (no accidental data loss).
- [ ] Duplicate sale day for same date is blocked with a clear toast.
- [ ] Personal withdrawals (when Expenses ships) must NOT reduce profit — tracked as cash.

Report any red error toast verbatim (most likely: RLS, or an RPC arg mismatch).

---

# Phases 3–4–7 — Expenses · Cash · Cheques · Settings (test locally)

## Expenses (Spend)
- [ ] + Expense → category (or type a new one) + amount + payment → Save → appears; total updates.
- [ ] Void an expense (✕ → confirm) → removed from total, kept for audit.
- [ ] Withdrawals are NOT here (they're on Cash).

## Cash (Money)
- [ ] + Cash in / − Cash out → balance changes (recalc).
- [ ] Withdraw → balance drops; labelled "not an expense"; does NOT reduce profit.
- [ ] Count cash → enter counted; if it differs from expected, a voidable adjustment lands the balance on reality; difference shown.
- [ ] Void a movement (✕ → confirm) → balance recomputed.

## Cheques / Settlements
- [ ] Open this month → a settlement period appears (rent + 3% seeded).
- [ ] + Cheque → pick period (expected auto-fills net_expected), status, received amount+date → Save.
- [ ] Reconcile (confirm) → status → reconciled; difference shown vs expected.
- [ ] Void cheque (confirm) → removed from totals, kept for audit.

## Settings
- [ ] Edit tracking-start date / low-stock default → Save → persists (app_settings).
- [ ] Set monthly rent / revenue share % → Save → new effective-dated location_term (future periods use it; existing unchanged).

## Capability badge
- [ ] Header + System show "Operational · Imports coming soon".
- [ ] Global + offers Sale/Purchase/Product/Expense/Count-cash (enabled); only "Upload screenshot" is Coming soon.

---

# Phase 6 — Imports (CSV → preview → approve)
- [ ] Imports → Daily sales → upload CSV (date,total) → preview shows ready/duplicate/blocked.
- [ ] Approve → creates sale days; already-present dates are skipped (dedup); counts shown.
- [ ] Imports → Expenses → upload CSV (date,category,amount) → approve creates expenses (+ new categories).
- [ ] Nothing saves until **Approve** is clicked (no auto-save).
- [ ] Reports: Stock / P&L / Expenses / Cheques CSV all export.
- [ ] Header + System badge read "Fully operational".

---

# Cycle — Insights, activity feed & full write-flow QA

The insight/activity **logic is pure and unit-tested** (`src/core/__tests__/logic.test.ts`,
34 tests). The checklist below is what to verify **locally with Supabase**, since the
build container can't reach `*.supabase.co`. Each insight on screen names the data it
uses, why it matters, an action, and an honest confidence chip (`estimate` / `needs data`).

## Risks & signals (Today + Gaps)
- [ ] **Negative stock** → a **critical** insight "X is at negative stock" linking to Buy. Fix: record the missing purchase → insight clears.
- [ ] **Out of stock** (on-hand 0) → **warning** linking to Buy.
- [ ] **Days of cover** → only appears for a product with ≥7 days of sales history and <7 days of stock left; shows an **estimate** chip. Thin history must NOT produce a forecast.
- [ ] **Cash negative** → **critical** "Cash balance is negative". Counting cash should clear it.
- [ ] **Withdrawals > inflow** in the period → **warning** on Cash.
- [ ] **Never counted cash** → **needs data** info, not a hard warning.
- [ ] **Settlement expects money, no cheque** → **warning** linking to Cheques.
- [ ] **Cheque differs beyond tolerance** (max(5, 0.5% of expected)) → **warning** with the signed difference.
- [ ] **Revenue trend** → "up/down N% vs last month" only when last month has data; otherwise "Not enough history" (**needs data**), never a fake %.

## Activity feed (Today)
- [ ] Shows the last 30 days of events (sales 🟢, purchases 📦, expenses 🧾, cash 💵, withdrawals 🏷️, cheques 🏦), newest first.
- [ ] Money in is green `+`, money out is muted `−`; tapping a row navigates to the right screen.
- [ ] Voided records do NOT appear.

## Full operational QA — run each write, confirm the read updates
| Flow | Action | Expected | Watch for (verbatim error) |
|---|---|---|---|
| Goods create | + Product, name+price | appears in Goods; toast "Product added" | RLS: `new row violates row-level security policy for table "products"` |
| Goods edit | tap product, change price/active | list updates; toast "Product updated" | — |
| Goods active | toggle Active off | shows "inactive" badge | — |
| Aliases | add alias via import matcher | future imports match the alias | unique-violation on duplicate alias |
| Purchase | + Purchase, qty(base)+cost | on-hand ↑, weighted cost shows, "no COGS" clears; toast "stock & cost updated" | RPC: `function create_purchase(...) does not exist` → engine wrappers/arg mismatch |
| Sale create | + Sale, date+total | appears in Recent; toast "Sale day created" | duplicate day: `A sale already exists for that day — open it to add items.` |
| Sale line add | open day, + line | on-hand ↓ by qty; COGS captured; toast "stock deducted" | RPC arg mismatch on `create_sale_item` |
| Sale line edit | ✎, change qty | stock reverses old + applies new (net only) | — |
| Sale line void | ✕ → confirm | stock restored; line gone | — |
| Sale day void | "Void whole day" → confirm | day voided; movements reversed; revenue drops | — |
| Expense add | + Expense, category+amount | appears; total ↑; net profit ↓ | `Pick or name a category.` if neither chosen |
| Expense void | ✕ → confirm | removed from total, kept for audit | — |
| Cash in/out | + Cash in / − Cash out | balance recalcs | — |
| Withdraw | Withdraw | balance ↓, labelled "not an expense", profit unchanged | — |
| Cash count | Count cash | voidable adjustment lands balance on reality; difference returned | — |
| Movement void | ✕ → confirm | balance recomputed | — |
| Settlement open | "Open this month" | period appears (rent + 3% seeded), idempotent on repeat | RPC: `ensure_monthly_settlement_period` missing |
| Cheque record | + Cheque, status received | needs amount+date | `A received cheque needs an amount received and a received date.` |
| Cheque reconcile | reconcile → confirm | status → reconciled | — |
| Cheque void | ✕ → confirm | removed from totals, kept for audit | — |
| Imports | CSV → preview → Approve | creates rows; dedup skips existing dates; nothing saves before Approve | — |
| Settings | edit tracking/low-stock/rent/share | persists (app_settings / new location_term) | — |
| Reports | export each CSV (Stock/P&L/Expenses/Cheques/Products) | downloads real data; P&L CSV includes net profit + opex | — |

## Known edge cases (verified by static audit, confirm locally)
- Voiding a cash movement before the accounts query resolves passes `accId!`; in
  practice movements only render once an account exists, so this is unreachable in UI.
- Purchase allows `unit_cost = 0` (intentional — a free/sample batch keeps WAC honest).
- Sale line `unit_price = 0` is allowed; COGS still snapshots from product cost.
- Any red toast you see is the raw Postgres/RPC message — capture it verbatim; the
  most likely causes are RLS (`permission denied`) or an RPC arg/name mismatch.

---

# Cycle 1 — Production-readiness audit (static-verified, run live to confirm)

## Cash-count path: CONFIRMED CORRECT (no engine bypass)
A prior audit flagged a possible bypass. **It was wrong.** `record_physical_count`
is the **inventory** stock-count RPC (`p_product_id`, `p_location_id`,
`p_counted_qty`) — unrelated to cash. There is **no** cash-count RPC. The cash
count correctly: inserts `cash_reconciliations`, posts a voidable `adjustment`
`money_movement` for the difference, then calls the verified `recalc_money_account`
RPC. Nothing is bypassed. No gating needed.

## Cash vs Profit (fixed this cycle)
The cash ledger (`money_movements`) is **drawer-only and never touches profit**.
P&L is driven solely by the `expenses` table + sale-item COGS.
- **Spend → Add expense** → affects **profit** (and the expense total). Does NOT move cash.
- **Cash in / Cash out** → affects **cash only**. Does NOT affect profit.
- **Withdraw** → affects **cash only**, forced to `personal_withdrawal`, never an expense.
- A cash-paid business cost that should reduce profit must be entered as an **Expense**;
  if you also want the drawer to drop, additionally record a **Cash out** (or let the
  next **cash count** reconcile the drift). Each Cash form now states its profit impact.

## Write-flow readiness matrix (UI · mutation · validation · confirm · refresh · test)
| Flow | UI | Mutation | Validation | Confirm (risky) | Refresh | Local test |
|---|---|---|---|---|---|---|
| Goods create | StockScreen +Product | `createProduct` | name required | n/a | `invalidateQueries` | +Product → appears |
| Goods edit | tap product | `updateProduct` | name required | n/a | invalidate | edit price → persists |
| Goods active | edit form checkbox | `updateProduct`/`setProductActive` | — | n/a | invalidate | toggle → "inactive" badge |
| Aliases | (import matcher) | `addAlias` | trims/normalizes | n/a | invalidate | alias matches on import |
| Purchase create | PurchaseForm | `addPurchase` (RPC) | product + qty>0 + cost≥0 + location | n/a | invalidate | on-hand ↑, WAC shows |
| Sale create | SaleForm | `createSale` | loc+channel+date, total≥0, **dup-day guard** | n/a | invalidate | dup day → blocked msg |
| Sale line add | SaleDetail +line | `addSaleItem` (RPC) | product + qty>0 | n/a | invalidate+refetch | on-hand ↓, COGS shown |
| Sale line edit | ✎ | `editSaleItem` (RPC) | product + qty>0 | n/a | invalidate+refetch | net stock change |
| Sale line void | ✕ | `voidSaleItem` (RPC) | — | ✅ Confirm | invalidate+refetch | stock restored |
| Sale day void | "Void whole day" | `voidSale` (RPC) | — | ✅ Confirm | invalidate, close | revenue drops |
| Expense add | ExpenseForm | `addExpense` | location + amount>0 + category | n/a | invalidate | total ↑, **net profit ↓** |
| Expense void | ✕ | `voidExpense` | — | ✅ Confirm | invalidate | total reverts |
| Cash in/out | CashForm | `createMovement` | account + amount>0 | n/a | invalidate (recalc) | balance recalcs |
| Cash withdraw | CashForm withdraw | `recordWithdrawal` | account + amount>0 | n/a | invalidate (recalc) | balance ↓, profit same |
| Cash count | CashForm count | `recordCashCount` | account + amount≥0 | n/a | invalidate (recalc) | adjustment lands balance |
| Movement void | ✕ | `voidMovement` | — | ✅ Confirm | invalidate (recalc) | balance recomputed |
| Settlement open | "Open this month" | `openSettlementPeriod` (RPC) | location present | n/a | invalidate | period seeded |
| Cheque record | ChequeForm | `recordCheque` | period + expected≥0; received→amount+date | n/a | invalidate | appears with diff |
| Cheque reconcile | reconcile link | `reconcileCheque` | — | ✅ Confirm | invalidate | status reconciled |
| Cheque void | ✕ | `voidCheque` | — | ✅ Confirm | invalidate | removed from totals |
| Import approve | ImportsScreen | `createSale`/`addExpense` loop | per-row parse + **dedup** | (preview gates) | invalidate, reset | only new days created |
| Settings tracking/low | SettingsScreen | `setAppSetting` | numeric | n/a | invalidate | persists |
| Settings rent/share | SettingsScreen | `setLocationTerm` | numeric (button disabled if NaN) | ✅ **Confirm (new)** | invalidate | new effective term |

**Every risky reversal and every settlement-math change now requires a confirmation.**
Creating new records (products, sales, expenses, movements) does not — that's intentional.

## Exact errors to screenshot (verbatim)
- `new row violates row-level security policy for table "<t>"` → an INSERT/UPDATE RLS policy is missing for your role.
- `permission denied for table <t>` / `for function <fn>` → RLS / grant gap.
- `function <name>(...) does not exist` or `Could not find the function ... in the schema cache` → RPC name/arg drift vs `database.types.ts`.
- `A sale already exists for that day — open it to add items.` → expected dup-day guard (not a bug).
- `A received cheque needs an amount received and a received date.` → expected cheque validation.
- Any balance/stock number that does **not** change after a write, or a cash balance that diverges after a count → screenshot the screen + the value.
