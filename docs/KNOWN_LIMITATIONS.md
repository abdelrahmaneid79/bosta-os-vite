# BostaOS — Known Limitations

_Updated 2026-07-13. Honest list — nothing here is hidden in the UI._

## Data (owner inputs required — see the grouped questions)
1. **Inventory has no live data.** The ledger/WAC machinery is tested and ready, but stock was never counted. Days-of-cover, stock value and low-stock alerts are silent until an opening count.
2. **Cash has no live data.** All 40 historical movements were voided in the 2026-07 audit; no cash counts exist. "Cash on hand" currently equals cheques − expenses − purchases since books-start.
3. **Sales end 2026-05-31.** June–July 2026 daily totals not yet entered; every "today" view is ~6 weeks stale.
4. **Product-line detail ends Jun 2025.** Jul 2025 → May 2026 needs the owner's daily report images. Day 2025-07-07 was skipped (extracted 3,824.73 vs saved 2,739.70 — wrong image or wrong saved total; needs a human look).
5. **12+ POS codes have no product** (top: 00025067, sold almost daily in Jun 2025) → their lines are skipped on import, leaving PARTIAL days.
6. **15 active products have no reference cost** → 259 live lines (EGP 34,435 revenue) carry no COGS.
7. No bank statements / owner injections / other income recorded — P&L is business-cash only.

## Product
8. ⌘K "create" commands navigate to the screen but don't open the form.
9. Blanket `qc.invalidateQueries()` after writes — correct but refetch-heavy.
10. `audit_log` (hash-chained, migration 0013) is never written by app code; audit trail = per-row timestamps + void reasons.
11. Modal lacks a focus trap (Tab can escape the dialog).
12. `imports`/`import_rows` staging tables (0009) are unused by the current importers (they preview in-memory instead).
13. Editing an old sale line re-prices its COGS at the CURRENT weighted cost, not the historical one (SQL 0007, documented design).
14. Cash-count flow is 3 sequential writes (expected/recon/adjustment) — a mid-flight failure can leave a recon row without its adjustment (single-user risk, low).
15. Strategist screen (pre-rebuild) caches one briefing per day in `app_settings` and auto-fires one AI call on first visit each day.

## Environment
16. `.env` holds `SUPABASE_SERVICE_ROLE_KEY` — used ONLY by the local `_resume_import.py` script, never bundled (not VITE_-prefixed). Keep it out of git (it is gitignored).
17. Edge-function auth relies on `verify_jwt` staying enabled at deploy time; the in-function check decodes but does not verify signatures.
