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

## Cycle 6 candidates (Layer 2 first)
1. Root-cause contribution analysis (per-product deltas explaining revenue/margin moves once two covered periods exist). 2. Cash-safety reasoning upgrades when the first drawer counts arrive. 3. Product portfolio classification (grow/hold/fix/drop with resolution tracking). 4. Recommendation outcome tracking (action completed → did the metric move?). 5. Purchase recommendation foundations (needs live inventory). 6. Live-provider verification + prompt tuning against real responses.
