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

## Cycle 12 (SHIPPED) — finish & harden (no new subsystems)
Refined recommendation quality and finished the interview loop. Recommendation quality: per-product cap (`maxPerProduct`, default 2) stops flooding one product with overlapping advice; `premium-weak-presentation` no longer nags a premium product already in a strong zone/level (fires only on unknown/weak placement); `profit-driver-low-space` no longer tells an already-well-faced product to add facings (fires only when facings ≤ 2 or unknown); `margin-recovery-review` excludes growing products (they get the mini-bag) so a product never gets duplicate pricing advice; in-season seasonal plays get a priority boost so an Eid gift play outranks a generic tweak during Eid. **Finished the interview loop**: a "Set up my stand" editor (per-product facings/zone/tier/traffic/keep + packaging-format catalog quick-add) so the owner can actually answer — every blocked recommendation becomes specific once answered. Dead-code sweep: removed `reasoningDiagnostics` (redundant with the gate's rejected list) and `markCloseStale` (staleness is computed live); covered the model-integration seam `runReasoningWithCandidates` with a test. Tests `retail-interview.test.ts` +4 quality refinements, `retail-authorship.test.ts` +1 seam; suite 463→468. Gates green (typecheck/468 tests/build); production read-only validation clean (no pollution; pre-live intact).

## Cycle 11 (SHIPPED) — Owner Knowledge Interview + packaging/merchandising context
Makes advice specific to the REAL Bosta Bites stand by asking the few things it can't derive. Migration `0038_owner_context` (additive): `packaging_formats` catalog (type, material, pack size, package/prep/label-seal cost, prep minutes, premium score, impulse/gifting suitability, shelf space, seasonal, applicable products) + products gain `quantity_breaks`/`do_not_discontinue`/`is_traffic_driver`; owner global context in app_settings `retail_context`.
- **`retail/interview.ts`** — 14 typed questions (packaging formats, per-product packaging, facings, display zones, adjacency, traffic drivers, do-not-discontinue, tiers, supplier terms, allowed promotions/display changes, occasions, bought-together, operational constraints). Each carries WHY it matters + what it UNLOCKS. `nextQuestions` is progressive (highest-value first), answers = data-derived OR owner-addressed (incl. deliberate "unknown"), so confirmed answers are never re-asked and missing context is never guessed.
- **`persistence/retail-context.ts`** — load/save owner context, `markQuestionAnswered`, `setProductContext`, packaging-format catalog CRUD, `assembleInterviewState`.
- **Facts integration** — `RetailBusinessFacts` now carries `offeredPackaging`, allowed promotions/display-changes, occasions, operational constraints; `ProductFact` carries `quantityBreaks`, `doNotDiscontinue`, `ownerTrafficDriver`.
- **Specificity gate** — merchandising/packaging advice only becomes specific when the context exists, else it states exactly what to confirm: no exact facing move without facings (→ space review), no mini-bag test without a costed offered format (→ "confirm you offer a mini-bag format and its cost"), do-not-discontinue products are never told to drop, an owner-confirmed traffic driver upgrades the pricing call to a measured conclusion. New context playbooks: supplier quantity-break, cheque-cycle purchasing.
- **UI** — "A few things only you know" card surfaces the top 3 questions with why/unlocks, inline answers for list questions, mark-unknown; progress counter.
- **Tests** — `retail-interview.test.ts` (13): interview ordering/skip/progress, mini-bag blocked-vs-specific, historical/unknown packaging safe, do-not-discontinue respected, owner traffic driver → measured, facings-known → exact move, quantity-break + cheque-cycle playbooks. Library 18→22. Suite 450→463. Production validated (packaging catalog empty, 3 context cols, RLS; 55 products with 0 merch fields → interview asks packaging/facings/traffic first).

## AUTHORSHIP BOUNDARY (owner correction 2026-07-13)
The external model MAY author interpretations, hypotheses, merchandising/packaging ideas, strategic challenges and experiment proposals — it may contribute creative reasoning; it may NOT define truth. Model-authored ideas enter as CANDIDATES through the SAME deterministic validation the deterministic playbooks use. Encoded in `retail/candidates.ts`: `ingestCandidates` is the single funnel (confidence capped by ceiling AND coverage/freshness → truth assigned → quality gate → low-value suppression → dedupe → rank) for candidates of every source; `validateModelCandidate` enforces the experiment-design layer for a model idea (must name REAL products, cite evidence RE-ATTACHED from deterministic facts, include a measurable test — else rejected/repaired), forces its truth to hypothesis/inference (never measured) and caps confidence to medium. Every recommendation carries `source`: `deterministic_knowledge | bosta_experiment | model_reasoning`, shown in the UI + NLG. Reference domain engines (`retail/domains.ts`): `marginIntelligence` (margin/pricing) and `merchandisingPackagingIntelligence` (merchandising/shelf/packaging) — thin selectors over the shared framework, the pattern every future domain engine follows. Tests: `retail-authorship.test.ts` (7). Playbook contract extended with executive-knowledge fields (rationale, whenApplicable/whenNotApplicable, assumptions, kpis, reviewCadenceDays, relatedPrinciples); library now 18 (added cashew-beside-jelly adjacency + premium entry-size pack). Suite 443→450.

## Cycle 10 (SHIPPED) — the Retail Reasoning System (`src/core/strategist/retail/`)
Combines trusted facts + structured FMCG knowledge + grounded reasoning into SPECIFIC commercial recommendations, ZERO API. Migration `0037_retail_reasoning` (additive): optional product merchandising/packaging fields (packaging_format, pack_size_g, packaging_cost, display_zone, shelf_level, facings, tier, impulse_type, min_order_qty, supplier_lead_days, adjacent_product_ids — all nullable) + `retail_experiments` table (RLS admin_all).
- **`contract.ts`** — `RetailBusinessFacts` / `ProductFact` (provider-neutral facts), `KnowledgePlaybook`, `RetailRecommendation` (full field set), `Experiment`, and the three truth levels: `measured_conclusion` / `strong_inference` / `experiment_hypothesis` — always visible on every output.
- **`knowledge.ts`** — the Retail Knowledge Library: 16 typed, grounded playbooks (high-value slow mover, dead stock, overstock-vs-cover, stockout-risk on a profit driver, profit-driver-low-space, weak-excess-facings, premium-weak-presentation, candy-impulse-placement, growing-margin-below-floor → mini-bag, grab-and-go, high-volume-low-margin traffic, margin-recovery, missing-cost, avoid-discount-strong, portfolio-concentration, Eid premium packaging). Each carries principle/conditions/required-evidence/contraindications/mechanism/test-design/metrics/confidence-ceiling/BASIS(retail_math|owner_confirmed|heuristic|bosta_experiment)/version + deterministic `match`/`build` (or portfolio-level `global`). Framework scales to the full 30–50; 16 shipped.
- **`facts.ts`** — `composeRetailFacts` (pure) + `assembleRetailFacts` (IO) from the audited snapshot + optional merchandising fields; never invents — layout/packaging stay null and the engine states "needs this observation".
- **`reasoning.ts`** — `runRetailReasoning`: matches playbooks to facts, classifies truth, caps confidence by playbook ceiling AND data coverage/freshness (never weak-signal→confident; a "test X" move is always a hypothesis), gates, suppresses low-value noise, dedups against open experiments, ranks, caps to the best 8.
- **`quality-gate.ts`** — `gateRecommendation` (references facts, confidence ≤ evidence, correct classification, measurable success, review trigger, cash/stock sanity, no confident measured claim on stale books) + `isLowValue` suppression. Prefers three excellent recommendations to twenty shallow ones.
- **`nlg.ts`** — deterministic executive language: conclusion → evidence → interpretation → action → method → success → risk → classification+confidence, with a `BANNED_FILLER` list proven absent by tests.
- **`learning.ts`** — deterministic learning from `retail_experiments`: prefers moves a PRIOR test on the SAME product kept (cites the experiment), cautions on reversed ones; never generalises one result across categories.
- **UI** — Strategist "What I would do" surface: top recommendations with Why / How to execute / How to test / What could make it wrong / Classification+Confidence, domain filters, and "Add as experiment" for hypotheses.
- **Tests** — `retail-reasoning.test.ts` (23): the almonds/cashews/traffic/mini-bag/facings-missing/premium/dead-stock/unaffordable/Eid/concentration scenarios + confidence discipline + gate + dedupe + NLG-no-filler + facts composition. Suite 420→443.
- **Real-data validation (read-only, 2026-07-13)**: migration verified (11/11 product cols, retail_experiments RLS, 0 rows); the real Apr→May books contain exactly the target cases — **Almonds 16.3% margin** and **Walnuts 6.9% margin** (below the 30% floor → price/pack-test hypotheses), **Jamy Jelly 48% margin at 18% revenue share** (→ don't-discount-strong). Merch fields empty → engine correctly requests those observations rather than fabricating layout.

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
