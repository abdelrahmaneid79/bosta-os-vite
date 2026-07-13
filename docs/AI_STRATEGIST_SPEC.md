# BostaOS Strategist — Architecture (as implemented)

_Updated 2026-07-13, end of Cycle 5. This describes the shipped system, not intentions._

## The three layers

```
Layer 1 — BUSINESS ENGINE (authoritative facts)
  src/core/read/*  ·  src/core/db/*  ·  SQL RPCs/triggers (WAC, settlements)
  Owns every financial number. Deterministic, audited, LLM-free.
  → produces the raw inputs for Snapshot V2

Layer 2 — STRATEGY ENGINE (proprietary BostaOS intelligence)
  src/core/strategist/
    contract.ts        Metric{value,source,period,basis,confidence,completeness,screenLink}
    snapshot-v2.ts     composeSnapshotV2 (pure) + assembleSnapshotV2 (I/O over Layer 1 only)
    context.ts         owner targets/preferences (app_settings.strategist_context_v2) over documented defaults
    analysis/engine.ts detectChanges → findDrivers → findContradictions → dataQuality → opportunities → rankFindings
                       Finding{class,evidence,impactEgp,urgency,confidence(=CEILING),drivers,assumptions,
                               resolutionCriteria,alternativeAction,persistEligible,action,missingData,rank}
    analysis/report.ts buildStrategyReport → StrategyReport{executive(status/reason/headline/topRisk/
                       topOpportunity/topDataIssue/mostUrgentAction), findings, contradictions,
                       dataQuality, decisionContext, maxConfidence, freshness}
    analysis/decision.ts / withdrawal.ts   deterministic scenario numbers + withdrawal verdicts
    questions.ts       suggested questions generated from live findings
    persistence/       lifecycle.ts (pure plans: insert/recur/reopen/auto-resolve, action dedup,
                       owner memory) · store.ts (the only module touching strategist_* tables)
  Decides WHAT matters, WHY, what action, what confidence, what persists, what resolves.

Layer 3 — LANGUAGE LAYER (replaceable infrastructure)
  src/core/strategist/language/
    types.ts           LanguageProvider/LanguageRequest/LanguageResult — the ONLY types the UI imports
    deterministic.ts   MANDATORY template provider: briefings, topic answers (margin/cash/cheques/
                       stock/products/priorities/improvement/missing-data), withdrawal parsing
                       (English+Arabic), honest refusals naming what IS answerable. No key, no cost.
    anthropic.ts       the ONLY client file that knows Anthropic exists; transport to the
                       business-strategist edge function (which holds model/prompt/schema/caching)
    validate.ts        border control: numeric grounding vs a corpus from snapshot+report+decision
                       context, confidence-ceiling downgrade, disclosure repair
    router.ts          generateLanguage(): settings-driven, explicit-intent only, daily call budget,
                       fallback on unavailable/throw/malformed/ungrounded — engine output never lost
  supabase/functions/business-strategist   (deployed v5) — the Anthropic adapter's server half:
    8 modes, forced tool-use JSON schema, 20-rule system prompt, prompt caching, per-mode token caps,
    90s timeout, anon→401.
```

**Ownership rules:** Layer 1 owns calculations. Layer 2 owns judgment (primary issue, action, urgency, confidence ceiling, persistence, resolution). Layer 3 owns wording only — it may not calculate, invent, alter evidence, exceed ceilings, or introduce recommendations the engine doesn't support.

## Running without any API key
Everything works: snapshot → report → workspace (briefing, findings, evidence, actions, Ask with topic answers, withdrawal decisions) via the deterministic provider. Set Tune → Language service → "Off — BostaOS templates only", or simply have no credits — the router falls back identically, with the reason shown.

## Adding a provider
1. Implement `LanguageProvider` (`id`, `isAvailable`, `generate`, `health`) in `language/<name>.ts`. `generate` must return a `StrategistResponse` (validate with `parseStrategistResponse`).
2. Register it in `router.ts` REGISTRY (or via `registerProvider` — the test seam proves core layers need no changes; see `strategist-language.test.ts` "FAKE provider plugs in").
3. Add its id to `LanguageSettings["provider"]` and the Tune select.
Nothing in Layers 1–2, persistence, or the UI changes. Every response still passes `validate.ts`.

## Disabling providers
Tune → "Off — BostaOS templates only" (`strategist_settings.provider = "deterministic"`), or uncheck "Allow enhanced" (`allowEnhanced: false`), or set the daily call cap to 0.

## Validation & confidence
`validate.ts` runs on every external response: numbers >100 in headline/conclusion/priorities/evidence must ground (±0.5%) in the snapshot/report/decision-context corpus, else the response is REJECTED → deterministic fallback with the reason. Priority confidence above `report.maxConfidence` is downgraded (repair, logged). Missing data-quality disclosures are appended. The ceiling itself comes from Layer 2 (finding confidence, degraded when completeness < 50).

## Memory
Provider-neutral, in the strategist_* tables: completed actions, dismissed insights (+notes), negative feedback (+reasons) → `buildOwnerMemory` compact facts (behavioral only, never business numbers) passed to providers as context. Old AI outputs are never truth: every answer renders from the CURRENT StrategyReport (test: "memory can never override live data").

## Testing each layer
- Layer 1: `financial-contracts`, `profit-coverage`, `logic` + module suites (`npm run test`).
- Layer 2: `strategist-engine.test` (13 scenarios), `strategy-report.test` (status/ceiling/scenarios), `decision-context`, `strategist-persistence` (lifecycle/dedup/memory).
- Layer 3: `strategist-language.test` — templates without credentials, fake-provider plug-in, fallback on throw/unavailable/invented-number/over-confidence/budget, validator internals.
Run: `npm run typecheck && npm run test && npm run build` — 280 tests, no network, no keys.

## Provider cutover / rollback
Edge fn `business-strategist` v5 (structured) is DEPLOYED with verify_jwt; anon → 401 verified; `read-day-report` untouched. Rollback: redeploy the v1 free-text function from git history (`git show dd248ac~1:supabase/functions/business-strategist/index.ts`) — the router treats its responses as malformed and falls back to templates, so even a bad rollback cannot break the workspace.

## Verification status (honest)
- Built + locally tested + adapter-tested with mocks: everything above.
- **Live-provider verified: NO.** Anthropic credits were exhausted throughout Cycle 5 (re-checked 2026-07-13, ~$0.00 spent — the ping itself was rejected). When topped up, run the $3 controlled check: one enhanced briefing, one question, one withdrawal decision, one refusal case — capture latency/tokens/cache/grounding via Tune → Diagnostics and `scratchpad/live_test.py`.

## Performance (measured where possible)
Engine + report build: ~1–5 ms on realistic fixtures (test timings). Snapshot assembly (~19 paged reads) and insight sync require the owner's session — live numbers appear in Tune → Diagnostics (snapshot/engine/sync/language ms, fallback + repair counts). Optimize only if the diagnostics show pain; candidates: server-composed snapshot, memoized month readouts.

## Cycle 6 (SHIPPED) — root-cause & product intelligence
All in `analysis/products.ts` + `analysis/priority.ts` + `persistence/outcomes.ts`, pure and provider-independent; carried on StrategyReport:
- **Contribution**: per-product revenue/GP deltas with share, concentration, explained vs UNEXPLAINED slice; refuses below 60% coverage. Production-validated on Apr→May 2025 (100% coverage): Δ −4,418 fully explained, broad decline led by فول اسواني (−4,365) while GP stayed ≈flat (mix shifted to candy).
- **Decomposition**: GP change → volume/price/mix/cost effects on observed per-product prices+costs; residual stays visible; refuses under 3 comparable products.
- **Portfolio classification**: multi-tag (star/volume/profit driver/HVLM/LVHM/weak/declining/emerging/stock-risk/cost-unknown/data-insufficient/dormant/review-*) with reason, action, resolution criteria per product; thresholds labeled owner-confirmed/system-default/derived (Tune: margin floor, dead-stock, stockout, max-cover, review period, cheque age, priority focus — confirmation dates stamped).
- **Shelf priority**: relative score → expand/maintain/reduce/investigate/insufficient; explicit "no shelf dimensions recorded" caveat; never invents facings.
- **Pricing reviews**: below-floor/price-inconsistency/demand-vs-margin signals; break-even + target-margin price only when cost is known; "demand response unknown — test before full rollout" always.
- **Purchase reviews**: days-of-cover from tracked stock+velocity; stockout/excess signals; with untracked inventory (production today) → DATA-FIRST actions ("record a count for X"), never invented quantities.
- **Outcome tracking** (migration 0034, additive on strategist_actions): baseline captured at acceptance (finding evidence verbatim + impact + resolution criteria), review date = +reviewPeriodDays; deterministic verdicts (gone→improved / +25% impact→worsened / review-due→no-change / coverage-collapse→awaiting-data / dismissed→cancelled) with the attribution caveat stored. The LLM never judges outcomes.
- **Weekly priority**: 1 primary + ≤2 secondary; cash-safety outranks opportunities; dismissed issues stay suppressed unless materially worse; open actions become "finish the queued action"; "monitor" only when nothing actionable exists.
- Validation script: `npx vite-node scripts/_validate_cycle6.ts <real-products.json>`.

## Cycle 7 candidates
1. Live-provider verification (credits) + prompt tuning with the enriched report. 2. Cash-safety reasoning once drawer counts exist. 3. Purchase quantities once inventory is live (units/lead-time/safety-stock policy). 4. Outcome-informed recommendations (engine learns which action types resolve fastest). 5. Seasonality-aware baselines (Ramadan-adjusted comparisons using the calendar).
