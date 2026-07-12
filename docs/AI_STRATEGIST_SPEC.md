# BostaOS — AI Strategist Spec (Stage 2 rebuild)

_Written 2026-07-13, before Cycle 2. This is the contract the rebuild is held to._

**Status:** Cycle 2 SHIPPED — `src/core/strategist/contract.ts` (Metric{value,source,period,basis,confidence,completeness,screenLink}), `context.ts` (owner answers in app_settings.strategist_context_v2 over documented defaults), `snapshot-v2.ts` (pure composeSnapshotV2 + I/O assembleSnapshotV2; periods = latest active month vs previous active month; rolling windows anchor to last data date so stale books don't read as collapse), `analysis/engine.ts` (pure pipeline: detectChanges → findDrivers → findContradictions → dataQualityFindings → findOpportunities → rankFindings; Finding{class,evidence,impactEgp,urgency,confidence,action,missingData,score,rank}). 21 scenario/honesty tests in `strategist-engine.test.ts`. Live-assembly verification happens under the owner session in Cycle 4 (RLS blocks anon assembly by design).

**Cycle 3 SHIPPED (code complete, NOT yet deployed):** `supabase/functions/business-strategist/index.ts` fully rewritten — 8 server-side modes with per-mode instructions + token limits, forced tool-use response schema (headline/conclusion/priorities[rank,type,title,explanation,evidence[],recommendedAction,expectedImpact,urgency,confidence,missingData]/contradictions/dataLimitations/suggestedQuestions), 20-rule system prompt, prompt caching (two cached system blocks: persona + snapshot/findings data block), 90s timeout → 504 with deterministic-fallback signal, usage + latency in every response. Client: `client-v2.ts` (askStrategistV2, StrategistUnavailableError for graceful degradation), `response.ts` (shared types + parseStrategistResponse validator), `analysis/decision.ts` (computeDecisionContext — deterministic scenario numbers: cash headroom vs floor, withdrawal guideline, margin-point value, below-floor products; 4 tests). Fixture extracted to `analysis/fixture.ts` for eval reuse. **Deploy deliberately deferred to Cycle 4** so the live screen is never broken. **BLOCKER: Anthropic API credit balance is exhausted — live grounding test 400s; top-up required before Cycle 4 verification.**

**Cycle 4 SHIPPED:** the strategist workspace (`src/features/engine/strategist.tsx`, full rewrite) — executive briefing (deterministic-first, AI on explicit click only, cached briefing labeled with its snapshot), freshness strip, What Matters Now (top-3 + expand, class-differentiated cards, insight lifecycle chips), evidence drawer (owner-language source translation), action queue (accept/own/complete/dismiss, dedup by finding), Ask the Strategist (live suggested questions, structured answer cards with per-priority disclosure, feedback buttons), Decision Mode (withdrawal assessment with strictly separated money concepts + generic decision context; AI judgment optional). Persistence: migration 0033 (5 tables: conversations/messages/insights/actions/feedback; RLS admin_all verified; partial unique index blocks duplicate open actions; unique finding_id dedups insights), `persistence/lifecycle.ts` (pure: shouldPersistFinding threshold, planInsightSync insert/recur/reopen/auto-resolve, action dedup, buildOwnerMemory), `persistence/store.ts` (typed repository; 30-conversation retention). Old v1 code deleted: client.ts, config.ts, snapshot.ts, strategist-viz.tsx. AI availability states: available / unavailable / timeout / invalid-response / snapshot-error / auth — all render useful screens, no auto-retry ever.

**Deployment (Cycle 5, when credits are topped up):**
1. `supabase functions deploy business-strategist` (or MCP deploy_edge_function with verify_jwt) — deploys v2 over v4.
2. Verify anon 401: `curl -X POST https://vvswohkqypzjtmfnpmba.supabase.co/functions/v1/business-strategist -H "Authorization: Bearer <ANON_KEY>" → 401`.
3. Owner signs in → Strategist → "Generate AI briefing" → verify structured card renders with evidence + confidence.
4. Ask one question, check schema validation (parseStrategistResponse throws on malformed → error state shown).
5. Verify read-day-report untouched (photo importer still works).
6. Live grounding check: `python3 scratchpad/live_test.py` (fixture-based, asserts no invented numbers).

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
