# BostaOS — Master Scope

_Owner: Bosta Bites (single stall, EGP-only, single admin). Source of truth for what BostaOS must do. Backend engine is verified and frozen unless a change is explicitly scoped here._

## Non-negotiables (apply to every feature)
- **Real data only.** Charts, AI, and imports read live Supabase values. Never mock/placeholder numbers.
- **Never invent numbers.** The AI layer narrates over computed facts; it may not fabricate or estimate figures.
- **Approval before save.** No import (screenshot or file) writes without an explicit preview → edit → approve step.
- **Preserve correct logic.** Settlement / WAC / cash / cheque / reconstruction engines and the verified math stay. UI changes never alter calculations.
- **Owner language.** Hide technical fields (source_type, verification enums, IDs) from normal workflows.
- **Simple on top of powerful.** Advanced features live one tap down; the daily jobs stay frictionless.

---

## Feature 1 — Daily sales screenshot upload
Upload a PNG/JPG of the POS daily summary; the app extracts and stages it.
- Extract: date, products, quantities/weights, unit prices, line totals, grand total.
- Map Arabic POS product names → existing products via the alias matcher.
- **Preview before saving**; user can edit any extracted row.
- **Nothing auto-saves** — approval required.
- Saved rows tagged `source = screenshot/import` + a confidence status.
- Unmapped / missing products route to the **Missing Data Center**.
- Reuses the existing Import Center pipeline (`imports`/`import_rows`, alias matching, confidence→verification mapping).

**Acceptance:** a real screenshot produces an editable preview; approving writes sales tagged as screenshot-sourced; unmapped names appear in Missing Data; totals reconcile to the screenshot.

## Feature 2 — Advanced interactive charts
Interactive charts on Dashboard and Reports, driven by real aggregations.
- Respond accurately to filters: date range, product, expense category, cheque/settlement period, verified/estimated status, (location/channel later).
- Duration: daily / weekly / monthly / custom range.
- Editable labels, axis settings, visible-metric toggles, comparison periods where useful.
- Metrics: revenue, COGS, gross profit, operating profit, expenses, cash, cheque, inventory value, top products, weak products, margins, withdrawals.
- **Real Supabase data only.**

**Acceptance:** changing any filter re-queries and the chart matches the filtered DB totals to the cent; comparison period overlays correctly.

## Feature 3 — AI/LLM business analysis
A narration layer over the **deterministic** insight facts (the rule-based engine stays the source of truth).
- Inputs (computed facts only): revenue trends, product performance, margin changes, cash differences, rising expenses, owner withdrawals, cheque delays/reconciliation, inventory weakness, missing data.
- Output framed as: **What happened? · Why it matters · What to fix.**
- **Cites actual DB values; never invents numbers.**
- Architecture: deterministic engine builds a "facts pack" → LLM narrates over it under a facts-only contract → result cached. The existing `buildInsights` rule engine remains and gates trust.

**Acceptance:** every figure the AI states is traceable to a real query; with no API key, the deterministic insights still render (AI degrades gracefully).

## Feature 4 — Full frontend rebuild
Replace the current UI/navigation/workflow with the approved brand direction (jet + hot-pink, Fredoka/Plex, mascot; see `/design-reference`).
- Mobile-first, excellent on laptop. Feels like a **business command center**, not an accounting system.
- Quick actions, clean cards, simple reports, clear charts, guided workflows.
- Hide technical fields from normal flows.
- **Keep** correct backend/DB/business logic; do not delete working financial logic.

**Acceptance:** every working workflow survives; the app reads as premium/owner-first; no engine or query changed.

## Feature 5 — Simplicity rule
Even with all of the above, the owner can easily: add today's sales · upload a sales screenshot · add purchase · add expense · check profit · check cash · check cheque · check inventory · see what's missing · get AI advice · generate reports.

---

## Dependencies & decisions
- **LLM (features 1 & 3):** screenshot extraction (vision) and AI analysis use the Claude API (`claude-opus-4-8`). Requires `ANTHROPIC_API_KEY` and incurs per-call cost. Deterministic insights remain available without it.
- **Charting:** a real charting library over live aggregation queries (no mock data).
- **DB:** mostly additive/none — Feature 1 reuses Import Center; may add a `screenshot` source tag + confidence on import rows; Feature 3 may add an optional AI-briefing cache table.
