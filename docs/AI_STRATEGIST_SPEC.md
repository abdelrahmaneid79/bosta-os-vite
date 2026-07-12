# BostaOS — AI Strategist Spec (Stage 2 rebuild)

_Written 2026-07-13, before Cycle 2. This is the contract the rebuild is held to._

## Verdict on the current strategist (why it's being replaced)
- Free-text markdown reply; the "format" is a hardcoded client-side user message with a "What the data says" section — an invitation to narrate KPIs.
- Snapshot is pre-aggregated and truncated (top-6/8 lists), profit is this-month-only, no prior-period profit history, no cash-vs-profit bridge, no withdrawal history, no cheque aging, no per-metric provenance, no freshness stamp.
- One mode (daily brief), auto-fired on page visit, cached per day, no follow-ups despite full multi-turn plumbing.
- No conversation persistence, no prompt caching, no streaming.

**Kept:** edge-fn auth scaffold (`getKey` env→private_config, `callerIsAuthenticated`), client invoke seam (Bearer + 401 mapping), `calendar.ts` (pure, tested), SVG viz components, the audited read layer underneath, `app_settings` for objective/context, read-day-report fn (untouched).

## Non-negotiable rules (enforced in the system prompt AND the eval suite)
1. Never invent numbers. 2. Never hide missing data. 3. Never recompute audited metrics. 4. Never conflate revenue/profit/cash/cheque value. 5. Withdrawals are never operating expenses. 6. No trend claims without enough history. 7. No forecast without stated confidence. 8. No advice that could apply to any business. 9. Cite specific snapshot evidence for every claim. 10. Highest-impact issue first. 11. Always name the next action. 12. Separate fact from interpretation. 13. Surface contradictions. 14. Say "cannot know" when it can't. 15. One strong recommendation beats ten weak ones.

## Snapshot v2 (Cycle 2) — data contract
Every block carries `{ value, source, period, confidence, basis: fact|calculated|estimated|forecast|missing }`.
- Overview: period + prior period, business clock, completeness score, data freshness (latest sale date!), coverage stats.
- Revenue: current/prior, growth, rolling averages, best/weakest days, weekday pattern, seasonality.
- Profit: monthly SERIES (not one point) of revenue/known COGS/**unknown-COGS exposure**/gross/opex/net, coverage-aware margins.
- Products: top revenue/profit/margin, growth & decline, high-volume-low-margin, low-volume-high-margin, stock risk, per-product coverage.
- Inventory: on hand, value, negative, low, days-of-cover, stale/missing cost (currently: no live data — must say so).
- Expenses: total, category split, PoP change, spikes, recurring; withdrawals SEPARATE.
- Cash: expected vs recorded vs counted, unexplained diff, in/out/withdrawals, confidence (currently: no live data — must say so).
- Cheques: expected/received/outstanding/overdue/unmatched, differences, average delay, settlement-era context from location_terms (not hardcoded prose).
- Data quality: missing COGS, unmapped codes, line-coverage window, missing cash counts, staleness.
- Context: owner goals/targets/limits (from 2G answers or documented defaults), retail calendar, saved decisions.

## Reasoning pipeline (pure TS, unit-tested, runs BEFORE the LLM)
detect changes → find drivers → find contradictions → rank (impact, urgency, reversibility, confidence, actionability) → the LLM writes the narrative and judgment ON TOP of deterministic findings, never instead of them.

## Response contract (tool-use JSON schema, not free text)
Per finding: `{ conclusion, evidence[] (snapshot paths + values), whyItMatters, action { what, screen route, urgency }, confidence, missingData[] }`. Modes: daily_brief, weekly_review, question, decision_support, product_strategy, cash_review, cheque_review, data_quality. Mode templates live SERVER-side.

## UI (Cycle 4)
"What matters now" card, ranked priorities with evidence links, Ask panel (structured answers), decision mode, feedback (useful/not/dismiss/done), persistence: `strategist_conversations`, `strategist_insights` tables; past decisions feed the snapshot context.

## Cost
Prompt caching (`cache_control`) on the stable snapshot block; streaming on; target < $0.05/interaction typical.
