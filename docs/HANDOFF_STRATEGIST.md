# BostaOS — AI Strategist (LLM) Handoff

_Written 2026-07-06. For a new session continuing work on the LLM / AI business strategist._

## 0. Orientation
- **App:** BostaOS — financial brain + OS for **Bosta Bites** (weighted candy/snack/nut stand, POS concession inside an Egyptian hypermarket, cheque-settled). Owner: Abdelrahmane (non-dev, sole user).
- **Stack:** Vite + React 18 + TS (strict, `noUnusedLocals`) + Tailwind + Zustand + TanStack Query + Supabase (Postgres + RLS + RPCs). Pure-SVG charts. Dev on **Mac** `/Users/titchy/bosta-os-vite`.
- **Supabase:** project `bostaOSS`, ref **`vvswohkqypzjtmfnpmba`** (eu-central-1). Creds in gitignored `.env`. Anthropic key lives in the `private_config` table (service-role read) — reused by edge functions.
- **Deploy:** push to `main` → Vercel auto-deploys. Git auth is wired (`gh`, account abdelrahmaneid79).
- **Verify gates:** `npm run typecheck` · `npm run test` (**225 passing**) · `npm run build`. `npm run lint` is broken — ignore it.

## 1. The AI Strategist (the LLM feature) — architecture as built
Rebuilt the `/health` screen (Insights › **Strategist**) into a grounded AI business-strategist **health dashboard** that reasons ON TOP of the existing heuristic engines. Merged to `main` (PR #1, squash `b97aaa1`), deployed.

**Files:**
- `supabase/functions/business-strategist/index.ts` — Edge Function (deployed **v4**, ACTIVE, verify_jwt on). Model `claude-sonnet-5`, `max_tokens: 6000` (sonnet-5's extended thinking ate smaller budgets → empty replies; 6000 fits thinking + answer). Key via `private_config` (never client). `callerIsAuthenticated()` → anon/unauth get **401**. Does NO business math — every figure passed in. System prompt = expert snack/nut/candy retail persona + strict grounding + BI/trend mandate + case-study allowance.
- `src/core/strategist/snapshot.ts` — assembles the grounded fact-base from the **audited read layer only** (getAnalytics/getProfitReadout/getCashSummary/getChequeCycle/getStockSummary/getRevenueForecast/getHealthReport/getRiskInsights/getMissingData/getLifetimeProducts/getProductProfit/getBudgetStatus/getExpenseCategoryTrends). Includes a `trends` block (trajectory, MoM, YoY, best/worst month, top days). Product-level flagged **partial-coverage**.
- `src/core/strategist/calendar.ts` — PURE, tested (`__tests__/calendar.test.ts`). Egyptian retail calendar + days-until (Ramadan/Eids/back-to-school/Valentine/Mother's Day), hardcoded (no live feed).
- `src/core/strategist/client.ts` — invoke seam (mirrors `day-report-ai`: getSession → Bearer header → 401 handling).
- `src/core/strategist/config.ts` — the ONLY writes: `strategist_objective`, `strategist_context`, and the cached daily `strategist_briefing` in `app_settings`.
- `src/features/engine/strategist.tsx` + `strategist-viz.tsx` — the dashboard: KPI strip (revenue/latest-month/YoY/cheque income/cash/health gauge), AI daily briefing (auto-generated, cached per day), business-health RADAR, revenue-by-product donut, monthly trend area, weekday/top-product bars, recent activity, products-to-watch table, calendar strip. Objective/context behind a `⚙ Tune` toggle.

**Grounding (enforced in the edge system prompt):** Bosta's own numbers ONLY from the snapshot (else "not in the data"); real retail/snack/nut expertise + known case studies encouraged; calendar facts allowed; **inventing specific current external statistics forbidden** (commodity/market/competitor numbers). Verified live: echoes only snapshot figures, flags data gaps, no invented stats.

**Rule 9 (hard):** READ-ONLY over business data — never writes sales/COGS/settlement/money. Only writes = objective/context + cached briefing.

**Cost:** ~$0.03–0.08 per briefing (once/day, cached). **CSS gotcha:** `--panel/--panel2/--line/--pink` are raw RGB triplets → need `rgb(var(--x))` inline; `--mag/--violet/--cyan/--green/--amber/--red/--teal/--text/--muted/--dim/--faint` are full hex.

## 2. Live data state (2026-07-06)
- **Sales:** 579 daily rows, EGP **2,724,777** (2024-10-30 → 2026-05-31).
- **Cheques:** 56, EGP **2,594,202** (reconciled to the mall statement this session; 3× 32k = "nuts deal" income).
- **Expenses:** EGP **674,229** (rent double-count fixed).
- **Products:** 56; **47 costed** (9 pending); 40 vendor-tagged (Nut Man / Gamy / Bebeto).
- **Product-line detail:** was 86 days → **being expanded to ~240** (import in progress, §3).

## 3. ⚠️ IN PROGRESS — daily-report product-line import
A background batch is inserting product lines (sale_items) for **~155 days (Nov 2024–Jun 2025)** that had daily totals but no product detail. Daily totals already existed → **lines only, no duplicate days**.
- **Source:** `~/Downloads/Bosta Bites daily sales/` — per-month subfolders of daily POS report **PNGs** (the `.Xls` exports were malformed OLE2, unreadable by SheetJS/xlrd; used the images + vision instead).
- **Mechanism:** for each day → Claude **vision** (read-day-report SYSTEM prompt) → match `item_code`→`products.pos_code` → `create_sale_item(p_sale_id, p_product_id, p_raw_product_name, p_quantity, p_unit_price, p_line_total, p_notes)` RPC (snapshots COGS) → reconcile to the existing daily total; skip days off by >20%.
- **Reversible:** every line has `notes = '[daily-report import 2026-07-06]'` → undo with `delete from sale_items where notes='[daily-report import 2026-07-06]'` (or void).
- **RESUME (if unfinished / a new session):** run `python3 "~/Downloads/Bosta Bites daily sales/_resume_import.py"` — idempotent, recomputes missing days, skips done ones. Verify with pilot day 2025-02-01 (already imported: 21 lines, reconciled 5343.08).
- **New product codes surfaced (NOT in catalog — add these products, then re-run to capture their lines):** `00021286, 00021454, 00021643, 00021904, 00021908, 00022161, 00022308` (+ any more the full run logs).

## 4. Pending from the owner
1. **9 product costs** still unknown (`reference_cost` null): `00021294` بندق محمص, `00021456` بونبون, `00021747` لب مقشر, `00021901` كناكر, `00023739` ويفر مغطى, `00023740` ويفر رول, `00026697` زبيب, `00026698` جوز هند, `00027566` كاجو نى. Now higher-value — they complete COGS on many newly-imported lines.
2. **Bank statements / personal withdrawals / other income** — for a true cash + full P&L.
3. **Daily reports Jul 2025 → May 2026** — to extend product detail across the WHOLE history (currently only through Jun 2025).

## 5. Next steps for the LLM (priority order)
1. **When import finishes:** invalidate the strategist snapshot cache; product-mix / per-product margin / vendor analysis now viable across Nov 2024–Jun 2025. Report the final tally + any skipped days.
2. **Add the ~7 missing product codes** as products (with vendor + cost) → re-run resume script to capture their lines → fewer PARTIAL days.
3. **Add the 9 pending costs** when they arrive → margins complete on hundreds of lines.
4. **Prompt-cache the snapshot** (Anthropic `cache_control`) — stable within a session → cut per-query cost ~5×.
5. **Persist strategist conversations** (a table) — currently briefing is cached per day, no follow-up history.
6. **Business Context layer** (discussed with owner): a structured, human-editable knowledge doc/table (mall eras, nuts deal, supplier terms, decisions, objectives) fed into the snapshot as a `context` block — makes the LLM much sharper. See §6.

## 6. Proposed data architecture (owner wants a "single source" system)
Do NOT put numbers in a Google Doc. Layered instead:
- **Raw files → structured Google Drive folders** (`10_Sales / 20_Cheques / 30_Suppliers / 40_Expenses / 50_Contracts / 60_Reference / 90_Context`). The archive + ingest queue. (Google Drive MCP is connected.)
- **Extraction → an in-app "Inbox"** that reads a Drive folder, runs vision/parse, reconciles, and stages for **one-tap owner approve** (money-safe; never blind writes). Reuses the vision + importer infra.
- **Numbers → Supabase** (the validated single source of truth — already is).
- **Knowledge/"the why" → a Business Context doc** (human-editable) synced into a `business_context` table the strategist reads.
- **The app = the single window** on all of it.
Phases: 0) folders + move files, 1) draft the Context doc (high value), 2) build the Inbox, 3) nightly cron pre-processing.

## 7. Memory (auto-loads each session, `~/.claude/.../memory/`)
`user-abdelrahmane`, `bostaos-live-data`, `bostaos-engine`, `bostaos-design-system`, `bostaos-lint-broken`, `bostaos-mall-settlement`, `bostaos-strategist`. Keep them current.

## 8. Handy
- Strategist tab is behind login — a headless session **can't screenshot it**; the owner views it. Verify the edge fn via anon-401 + bundle-key-absence + a direct model call (Anthropic key from `private_config`).
- To live-test grounding without the owner's session: call the Anthropic API directly with the read-day-report/business-strategist SYSTEM + a real snapshot (pattern used this session).
