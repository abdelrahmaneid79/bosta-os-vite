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

## Cycle 7 (SHIPPED) — cash intelligence & affordability
`analysis/cash.ts` + `analysis/affordability.ts` + `analysis/forecast-cash.ts`, all pure, carried on StrategyReport (cash/obligations/cashProjection/runway):
- **CashState**: strictly separated blocks — available-now (verified count under the freshness policy), expected-not-available (ledger anchor + settlement pipe + next-cheque ETA from the ~10-day median cheque rhythm), committed (obligation calendar), uncertain (explicit: no count, untracked payment methods — ALL revenue settles via mall cheques, untracked clearing, stale books), owner movements, safety (reserve = fixed / 30d-costs / higher-of-both; verified/expected/downside headroom; verdict; blockers). Never one collapsed balance.
- **Obligations**: recurring cash costs derived from repeat categories (Salary ~5,700/mo real); RENT EXCLUDED by construction — the mall deducts it from the cheque; accepted owner actions join with dates; 7/14/30-day windows.
- **Withdrawal V2 / affordability**: three answer levels (verified/conditional/unknowable); CASH FIRST — profit is context only; optional spends need verified cash unless Tune allows expected; recurring costs get revenue-to-cover at the measured margin with NO assumed benefit; employee hire supported with labeled salary assumptions.
- **Projection**: 7/14/30d; known-only scenario has zero estimated sales; base/downside label every assumption (cheque delay +14d, sales −25% default); RELATIVE mode when uncounted (never fake balances); Eid/Ramadan overlap labeled.
- **Runway**: reserve-coverage months for a cash-generative business (never infinite); withdrawals and rent excluded from burn by construction.
- **Cash findings** ranked with everything else: cash-count-required/stale, obligations-unfunded, reserve-breach-risk, single-cheque concentration (neutral language throughout — "unexplained difference", never accusation).
- **Production validation (2026-07-13, read-only)**: verdict UNKNOWABLE with blockers "first drawer count" + "books end 2026-05-31"; withdraw-20k/buy-30k → unknowable with count-first next steps; hire@5,700 (labeled assumption) → needs ~14,250/month extra sales at the measured 40% margin; projection relative-mode; ledger-expected = EGP 0 (anchor 2026-07-01, nothing recorded since). Every refusal correct.
- No DB changes (justified: forecasts are never stored as facts; scenarios render live and go stale with the snapshot; obligations derive from existing records).
- Validation script: `npx vite-node scripts/_validate_cycle7.ts`.

## Cycle 8 (SHIPPED) — operational activation
The bridge from historical books to trustworthy live operations. Migration 0035 (applied, RLS verified): baseline flags + verification/bank/opening_difference on cash_reconciliations, is_opening_baseline on physical_counts, structured amount fields on strategist_actions, new daily_closes table.
- **activation.ts** — 8-step checklist (status/why/action/effort/unlocks/required), readiness state machine (historical_only → activation_incomplete → live_partial → live_operational → live_verified), activation findings that outrank product optimisation until operational and never nag once live.
- **reconciliation.ts** — opening-baseline classification (gap vs ledger is an OPENING DIFFERENCE, never expense/loss/withdrawal), interval reconciliation between count pairs (cheque revenue never counted as drawer cash), neutral difference classification (never theft — "unexplained difference").
- **inventory-count.ts** — opening stock baseline (a baseline adjustment, NOT a purchase/sale, no profit impact; missing cost → quantity-known/value-unknown), count variance (unit mismatch blocks, neutral candidates).
- **purchase-qty.ts** — quantity engine gated on units + live stock + velocity + lead time (assumed 7d, confirm w/ vendor); cash-aware combined verdicts (needed_and_affordable / needed_but_cash_constrained / wait_for_cheque / count_first / supplier_data_required / unsafe) — never bypasses cash safety, never auto-creates a purchase.
- **operations.ts** — daily close (blocks "complete" when required items missing, never fabricates), sales-gap detection (recent-first, never assumes zero), action-oriented missing-data grouping (Activate always outranks Historical cleanup), live health (historical vs live completeness split).
- **Persistence**: recordCashCount baseline-aware (opening difference does NOT post an adjustment movement); createAction carries amounts → obligation calendar; operations store (daily closes, live-start confirm, accepted commitments).
- **UI**: Activation tile (readiness + steps + inline live-start confirm), Daily Close tile, first-cash-count opening-baseline flow (auto-detected as the first count, bank field), cash-aware purchase plan in Product Strategy. Provider answers activation questions with zero API.
- **Production validation (read-only, 2026-07-13)**: readiness=historical_only, next step "confirm live start date", cheques already ✓, live 0% / historical 85% (gaps don't tank live), Activate group ranks above Historical cleanup. 55 active products, 0 missing units, sales to 2026-05-31, 0 counts — exactly the valid pre-live state.
- Three states distinguished: not-built / built-awaiting-activation / activated-with-real-data. The reconciliation-interval and count-variance engines are built + tested but their dedicated investigation UI activates once count pairs exist (they can't be exercised without them).
- Validation script pattern (temp, removed): the durable artifact is `strategist-activation.test.ts` (32 tests).

## CONSTITUTION IN CODE (`src/core/strategist/intelligence/`)
The permanent direction is now encoded. `contract.ts` defines the canonical `DomainFinding` — the 11 mandated fields every specialist engine MUST emit (Finding · Driver · Evidence · Business Context · Risk · Opportunity · Recommendation · Expected Benefit · Success Criteria · Confidence · Blocking Information) — plus `DomainEngine`, `IntelligenceReport`, `RetailDomain`, and `contractViolations()` (compliance guard). `adapt.ts` maps the existing `Finding` onto the contract so every Cycle-2..9 engine complies WITHOUT a rewrite. `nlg.ts` is the deterministic Natural-Language Generator (PRIMARY reporting) — renders findings into executive prose (brief/detailed/action), seeded-deterministic variety, combines + dedups, never invents (only the structured fields). Tests: `intelligence.test.ts` (11) — contract compliance, domain routing, NLG determinism. New specialist engines implement `DomainEngine` and emit `DomainFinding[]`; the NLG renders them; an external adapter (optional forever) may only re-voice.

## ARCHITECTURAL DIRECTION (owner, 2026-07-13) — permanent
**BostaOS itself is the strategist.** The language model is ONE optional presentation layer, never the decision maker. The app must produce world-class advice fully offline (zero keys). If every provider vanished, only conversational polish is lost — never intelligence. New mental model: Business Engine → **Retail Intelligence Engine** (many specialist deterministic domain engines) → **Decision Engine** → **Recommendation Engine** → **deterministic Natural-Language Generator** (templates + sentence composition, NOT an LLM). External providers, via adapters only, may rephrase/lengthen/answer open-ended follow-ups; they must never own calculations, reasoning, prioritisation, recommendations, confidence, or decisions. Every future sprint adds deterministic retail/FMCG knowledge, not prompts. See memory `bostaos-architecture-direction`.

## Cycle 9 (SHIPPED) — operational exception handling, daily-workflow automation, production hardening
Migration `0036_cycle9_hardening` (additive): daily-close lifecycle (version, confidence, source_data_at, is_stale, confirmations, auto_detected, reopen trail); `operational_exceptions` canonical lifecycle table; strategist_actions execution timestamps (accepted/started/overdue) + linked_exception_id; idempotency_key + unique partial index on expenses/money_movements/cheques/cash_reconciliations/physical_counts.
- **Automatic daily close** (`analysis/daily-close.ts` + `read/daily-close.ts`): derives the checklist from records (auto/confirm/blocked/optional/unresolved), owner attests only to what can't be read (no-trading, no-expenses, no-purchase, cash-skip reason). Never fabricates to close; state machine open/ready/complete/partial/estimated/no_trading/reopened + stale detection (source-data watermark) + reopen/void with reasons + versioning.
- **Canonical exception engine** (`analysis/exceptions.ts`): ONE `OperationalException` model with stable ids, built FROM the existing pure signals (risk insights, missing-data, cash/cheque/close/obligation/action) — no duplicated detection. Lifecycle reconciliation (open/ack/in_progress/resolved/dismissed/reopened/suppressed): new→open, resolved-returns→reopened, dismissed stays suppressed unless materially worse / window elapsed / critical, auto-resolve when no longer live. Persisted in `operational_exceptions`; consumed by the Strategist panel, the daily brief, notifications and the deterministic provider. Neutral language (a shortage is a "difference", never theft/loss).
- **Daily owner brief** (`analysis/brief.ts` + `brief-service.ts`): deterministic yesterday/today/trust + health verdict, generated entirely from records; the language layer may rephrase but cannot change a number, priority or action.
- **Deterministic operational Q&A** (`analysis/operational-answers.ts`): the engine answers "why can't I close / what caused this difference / is yesterday trustworthy / what before I leave / ready for activation …" with ZERO model calls — wired as the PRIMARY path in Ask (LLM only for open-ended).
- **Idempotency** (`db/idempotency.ts`): client keys + `*_idem` unique indexes; a double-submit/retry/second-tab is swallowed as already-saved; other unique violations still throw.
- **Corrections/audit**: void functions capture owner reasons; the activity feed now covers closes, counts, baselines and exception lifecycle (audit trail).
- **Denomination counting** (`analysis/denomination.ts`), **execution tracking + outcome attribution** (`analysis/execution.ts`), **notifications foundation** (`analysis/notifications.ts`, internal only), **diagnostics** (`diagnostics.buildDiagnostics`).
- **Tests**: `strategist-cycle9.test.ts` (43) — close automation/lifecycle, exception compose+lifecycle, brief, denomination, execution, operational answers, notifications, idempotency. Suite 366→409.
- **Production validation (read-only, 2026-07-13)**: migration verified (6/6 close cols, 5/5 idem indexes, RLS admin_all on operational_exceptions consistent with all tables); pre-live state preserved (0 counts, live_start null); 0 test rows; 21 unreconciled days confirm the engine surfaces real `sales_lines_mismatch` work.

## Cycle 10 candidates
1. Build out the specialist Retail Intelligence domain engines (Margin/Pricing/Promotion/Supplier/Basket/Seasonality…) each exposing finding→driver→evidence→risk→opportunity→action→benefit→success→confidence→blocking. 2. Elevate the deterministic Natural-Language Generator (varied sentence composition, concise/detailed/action-plan/briefing modes) so the deterministic path reads as executive prose. 3. Difference-investigation + count-variance UI once real count pairs exist. 4. Live-provider verification (credits). 5. Sales catch-up workspace UI over `detectSalesGaps`.
