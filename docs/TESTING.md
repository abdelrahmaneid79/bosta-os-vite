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
