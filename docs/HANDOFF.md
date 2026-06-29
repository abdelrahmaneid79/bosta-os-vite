# BostaOS — Session Handoff

The financial brain + operating system for **Bosta Bites** (a packaged-snacks/nuts retail stand inside a hypermarket "Hyper Hub" / جاردينيا مول, settled by mall cheques). Owner: Abdelrahmane. Single-owner app.

---

## 0. The 60-second orientation
- **Stack:** Vite + React 18 + TypeScript (strict, `noUnusedLocals`), Tailwind (CSS-variable theming), Zustand, TanStack Query, React Router, Supabase (Postgres + RLS + RPCs). Pure-SVG charts (no chart lib). `date-fns`, `papaparse`, `xlsx`, `tesseract.js`.
- **Repo:** `https://github.com/abdelrahmaneid79/bosta-os-vite` — branch `main`. Working dir `C:\Users\abdel\bosta os vite`.
- **Supabase (LIVE):** project `bostaOSS`, ref **`vvswohkqypzjtmfnpmba`**, region eu-central-1. Creds in `.env` (gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (client-safe), `SUPABASE_SERVICE_ROLE_KEY` (server/admin only — NEVER ship to client, NEVER `VITE_`-prefix it).
- **Auth:** Supabase email/password; the app runs every read/write under the owner's session (RLS `admin_all` on every table — intentional single-user model).
- **Verify gates:** `npm run typecheck` · `npm run test` (**181 passing**, vitest) · `npm run build`. **`npm run lint` is broken** (no eslint config/dep — ignore it; typecheck is the real gate).
- **Latest commit:** `ab60b02`. Everything is pushed to `main`.

---

## 1. How to run / deploy
```bash
git pull origin main
npm install
npm run typecheck && npm run test && npm run build   # all green
npm run dev          # local at the Vite port; sign in with the Supabase account
npm run preview      # serve the production build
```
**Deploy:** no in-repo deploy config. If a host (Vercel/Netlify/Cloudflare) watches `main`, pushes auto-deploy — it just needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env vars set in the host. SPA: route unknown paths to `index.html`. DB migrations are **already applied to live** (the `supabase/migrations/*.sql` files are a record only).

---

## 2. Architecture & conventions (FOLLOW THESE)
- **Pure logic** in `src/core/<domain>/*.ts` — no I/O, deterministic, **unit-tested** (every calc has a test in `src/core/__tests__/`).
- **Reads** (read-models) in `src/core/read/*.ts` — gather Supabase data, feed the pure modules. READ-ONLY.
- **Writes** in `src/core/db/mutations.ts` only; verified money math goes through Postgres **RPCs** wrapped in `src/core/db/engine.ts` (WAC, inventory ledger, settlement, money recalc). The app NEVER recomputes verified money math in JS.
- **UI** in `src/features/engine/*.tsx` + shared kit `src/components/ui/index.tsx`. Business logic stays OUT of components.
- **Money safety invariants:** void/reverse instead of hard-delete; "profit hides, never lies" (COGS missing → `unknown`, never guessed); personal withdrawals are cash, never expenses; historical data must not nag.
- **Theming:** CSS vars in `src/index.css` (`:root` light, `.dark` dark) → Tailwind `rgb(var(--x)/<alpha>)`. **Dark is default.** Fonts: Plus Jakarta Sans (display) + Inter. Premium fintech look (Stripe/Telda/Mercury vibe), hot-pink brand. `tnum` class for numbers. Full dates everywhere (`fmtDate` default = `d MMM yyyy`).

Key files: `src/app/EngineApp.tsx` (shell: Rail/Header/AlertBell/routes), `src/core/nav.ts` (nav source of truth), `src/store/{filters,prefs,ui,layout}.ts`, `src/components/{DateRangePicker,ProductPicker,charts}.tsx`.

---

## 3. Live data state (real Bosta Bites history, Oct 2024 → mid-2026)
- **Sales:** 579 daily revenue rows, **EGP 2,724,777** (2024-10-30 → 2026-05-31). Revenue = `Σ sales.total_amount`. `sale_items` = **0** (no per-product lines imported yet — see §6).
- **Products:** 59 catalog rows + 59 barcode aliases (Arabic POS names). `جامى بسكوت ويفر` ×4 are real distinct SKUs (different barcodes), not dupes.
- **Expenses:** EGP **755,229** across clean categories — **Stock purchasing** 597,399 (is_operating=false / goods cost), Rent 105,000, Packaging supplies 26,450, Salary 9,450, Equipment 7,800, Marketing 5,000, Software & subscriptions 4,130, Transportation (0). The Expenses screen shows ALL spend by category (unified — there is no separate "Spend/Purchases").
- **Cheques (mall settlement):** 40 real cheques, **EGP 1,741,822** (in both `money_movements` as cheque_inflow → drives the 1.74M cash balance, AND the `cheques` table). Reconciles: cash-era (pre-first-cheque) 711k + covered sales 2.01M = 2.72M total; cheques = covered × (1 − ~13.4% mall cut).
- **Costing:** 33/59 products have a backfilled unit cost (from `Bill.xlsx` supplier bills) → `products.reference_cost` + `app_settings.product_lifetime`. 22 "verified" (resale goods) + 11 "estimate" (roasted nuts; raw cost × **15% uplift** for roasting+packaging, owner-editable in Settings → Costing). Covers **92.4% of revenue**; blended margin ~36%. 26 products still cost-unknown (review queue). **NOTE: owner is providing UPDATED purchase prices — margins are provisional until then.**
- Source files: `bosta financials.zip` (Desktop) — daily/product POS exports (`.Xls` are malformed OLE2; only Excel COM/`xlsx`-via-2D reads them), `Bill.xlsx` (42 bills, 383k), `Bosta_Bites_Cheques.xlsx` (40 cheques).

---

## 4. What's built & working (verified: typecheck+build+181 tests green)
**Shell/UX:** premium light/dark theming + toggle (Settings → Appearance), redesigned sidebar/topbar, **AlertBell** dropdown (DB-backed dismissals, cross-device), **redesigned date-range picker** (Today/This week/This month/Last month/This quarter/This year/**All time**/Custom; Egyptian Sat-start week), ⌘K command palette, full-date labels everywhere, header month removed.

**Dashboard:** interactive 12-month revenue chart (period tabs 3M/6M/12M/All, labeled axes, hover tooltip), KPIs (Revenue 12-mo, Cash on hand, Net profit, **Awaiting cheque** = open tab), business-health ring, attention/risks/activity widgets, drag-to-reorder.

**Sales:** 579-day list, day detail receipt with add/edit/void product lines (via `create_sale_item` RPC), **searchable ProductPicker** (barcode + Arabic/English alias matching).

**Money:**
- *Cash:* balance, monthly in/out flow chart, movements, count/in/out/withdraw.
- *Expenses:* unified, all categories, filter, add/void, CSV import.
- *Cheques (reworked to the real flow):* no monthly "open period". Cheques cross-referenced to sales — each shows its **coverage window (date-to-date)** = sales since the previous cheque, implied mall cut; an **"open tab"** (sales since last cheque); pre-record **"cash era"** note; arrears labelled (not negative). Record cheque = date + amount (auto-attached to its month silently). `core/settlement/cheque-cycle.ts` (pure, tested).

**Reports:** KPI grid, daily revenue (bar/line/monthly), revenue-vs-purchases, expense donut, day-of-week, 7-day rolling avg, top days, **product leaderboards** (lifetime, with real profit/margin + cost-source flags), **Targets vs actual** (budgets), **Revenue forecast** card, P&L waterfall, CSV exports.

**Insights:** game-style Health Center, Gaps/Missing Data Center (incl. "products with sales but no cost" review queue), Activity feed.

**Engine modules (pure + tested):** Alerts (`core/alerts`), Budgets (`core/budgets`), Forecasting (`core/forecast`), Settlement recon + cheque-cycle (`core/settlement`), Product match/advice/profit (`core/products`), Product-line import (`core/import/product-lines.ts`).

**Product-line importer (`/sales/product-lines`, Sales → Product lines):** reads the real POS daily report — finds the header row under the metadata, Arabic-folded column detection (الباركود/اسم الصنف/متوسط سعر البيع/صافى الكمية/صافى القيمة), **barcode-first matching** (24/25 real barcodes resolve), sniffs the day from the "الفترة من …" header, skips totals rows, unmapped queue, day-total check. On Approve, creates `sale_items` on the day's receipt with COGS snapshot. **Verified end-to-end on Dec 3 2024: day total 3,403.17 matches the report; a line imported as qty 1.115 / value 167.24 / COGS 87.97 then rolled back.** Per-product COGS is REAL because `post_sale_item_movement` snapshots `cogs_at_sale` from `coalesce(avg_cost, reference_cost)` (migration 0019/0020), decoupled from the stock-tracking gate.

---

## 5. Schema / migrations added this work (all live + in `supabase/migrations/`)
- `0018_alert_dismissals` — `alert_dismissals(key, dismissed_at)` + RLS. Cross-device alert dismissals.
- `0019_reference_cost` — `products.reference_cost` (manual cost, never touched by WAC recompute); reworked `post_sale_item_movement` to snapshot COGS from `coalesce(avg_cost, reference_cost)` and decouple COGS from the inventory tracking gate.
- `0020_post_sale_item_search_path` — pins `search_path` on that function (security advisor fix).
- Data backfills (no migration): `app_settings.product_lifetime` (lifetime sales + costs), `app_settings.budgets`, `app_settings.cost_settings` (uplift %), `products.reference_cost`/`avg_cost` on 33 rows, cheques table (40), expense-category renames.
- `database.types.ts` was **hand-patched** for `alert_dismissals` + `reference_cost` (full `supabase gen types` would reconcile it — cosmetic).

---

## 6. Known gaps / pending (the "so much to fix" list)
1. **Real COGS/margins — BLOCKED on owner's updated purchase prices.** Plumbing is ready (`reference_cost` + COGS-on-sale-item). When costs arrive: update `products.reference_cost` (+ refine the 11 "estimate" uplift), and product margins go accurate everywhere with zero rework.
2. **`sale_items` are empty** until the owner imports daily product reports via `/sales/product-lines`. Until then: per-product per-range profit, live inventory, and dashboard gross profit stay "needs costs/lines". The importer works (verified) — it's a data-entry step.
3. **`inventory_tracking_start_date` is unset** → stock deduction is OFF (COGS still snapshots via reference_cost; stock stays 0, no negative-stock noise). Owner can enable in Settings when ready to track stock.
4. **Legacy/dead code (safe cleanup, not yet done):** monthly `settlement_periods`/`settlement_deductions` are now vestigial containers (cheque-cycle ignores them; sales trigger still auto-creates rent+3% deduction rows); `/settlement/:id` detail page + `getSettlementOverview`/`getSettlementDetail` + `core/settlement/logic.ts` are orphaned (nothing links to them). ~200 lines removable.
5. **Owner action items:** enable Supabase **leaked-password protection** (Auth dashboard toggle). Optionally add a `vercel.json`/CI deploy workflow.
6. **Malformed `.Xls`** phone exports can't be read by SheetJS — re-export as `.xlsx`/`.csv`.
7. Dev-only screens still in nav: **QA Mode**, **System** (could be hidden from the owner).

---

## 7. Commit map (this multi-session arc, newest first)
`ab60b02` POS daily report import (barcode/Arabic/1-day) · `c3efddd` backend hardening (search_path, drop stale alert) · `0ff5f89` unify expenses + cheque rework · `4a25b2e` date-range picker + All time + full dates · `b435b51` real per-sale COGS (reference_cost + uplift + review queue) · `fa54dcc` historical product profitability backfill · `63a0d25` bulk product-line importer · `6d4728c` cross-device alert dismissals · `f4a7b75` product deep-dive · `5160837` searchable product picker · `5c85693` cheque↔settlement recon · `49c7d40` forecasting · `7ee18ee` alerts + budgets · `3fa363c` settlements + product leaderboards · `aa523f6` premium UI redesign + live data.

---

## 8. Persistent memory (auto-loaded each session, at `~/.claude/.../memory/`)
`bostaos-live-data.md`, `bostaos-design-system.md`, `bostaos-engine.md`, `bostaos-lint-broken.md`. Update these as the source of truth evolves.

## 9. Suggested first move next session
Confirm whether the owner has sent **updated purchase prices** → if yes, backfill real costs (highest leverage: unlocks true margins). Otherwise: import a batch of daily POS reports to populate `sale_items`, and/or do the §6.4 dead-code cleanup. Always: `typecheck` + `test` + `build` green, commit per logical unit, push to `main`.
