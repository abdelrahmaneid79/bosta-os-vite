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
