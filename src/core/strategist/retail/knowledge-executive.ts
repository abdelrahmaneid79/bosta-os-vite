/** EXECUTIVE RETAIL KNOWLEDGE — expansion pack (Cycle 12 seeding).
 *
 *  15 additional board-level playbooks covering the domains the core library
 *  lacked: eye-level strategy, basket-driven adjacency, occasions (gifting /
 *  Ramadan / weekend), cost pass-through, assortment tail, supplier
 *  concentration, lead-time reorder, MOQ-vs-cash, protected products, sampling
 *  trial, threshold offers and evidence discipline. Same contract, same rules:
 *  deterministic match/build, labelled basis, never presented as proven for
 *  Bosta Bites unless a prior experiment says so. */
import type { KnowledgePlaybook, RetailBusinessFacts, ProductFact } from "./contract";
import { draft, ev, egp, pct } from "./helpers";

const floorOf = (f: RetailBusinessFacts) => f.marginFloorPct ?? 30;
const protectedName = (f: RetailBusinessFacts, p: ProductFact) => f.strategicProducts.includes(p.name) || p.doNotDiscontinue;

/* ═══ MERCHANDISING ══════════════════════════════════════════════════════ */

const eyeLevelProfitDriver: KnowledgePlaybook = {
  id: "eye-level-profit-driver", domain: "merchandising",
  title: "Profit driver below eye level",
  principle: "Eye level is buy level — your best profit per facing belongs where the eye lands first.",
  rationale: "Vertical position is the cheapest merchandising lever there is; moving a proven profit driver from a low/top shelf to eye level raises its exposure without giving it more space.",
  whenApplicable: "A top gross-profit product sits at a recorded low/mid/top shelf level.",
  whenNotApplicable: "Already at eye level, or shelf level unknown (ask, don't guess).",
  conditions: "Profit share ≥ 12% and recorded shelf level ≠ eye.",
  requiredEvidence: ["gross-profit share", "recorded shelf level"],
  contraindications: ["eye level already fully occupied by a stronger line"],
  mechanism: "Raising vertical prominence lifts unaided visibility and conversion at zero space cost.",
  actionTypes: ["change_shelf_level"], expectedBenefitType: "gross profit per facing",
  risks: ["displaces whatever holds eye level today"], assumptions: ["current eye-level occupant earns less per facing"],
  kpis: ["gross profit per facing", "units per facing"],
  testDesign: "Swap shelf levels with the current eye-level occupant for two cheque cycles; compare profit per facing of both.",
  minTestDurationDays: 28, reviewCadenceDays: 28,
  successMetrics: ["profit per facing up"], failureMetrics: ["swapped-down product falls more than this one gains"],
  relatedPrinciples: ["profit-driver-low-space"], confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p) => (p.profitSharePct ?? 0) >= 12 && p.shelfLevel != null && p.shelfLevel !== "eye",
  build: (p, f) => draft({
    title: `Move ${p.name} to eye level`, domain: "merchandising", type: "change_shelf_level", product: p,
    observedFacts: [`${p.name} drives ${pct(p.profitSharePct)} of gross profit but sits at ${p.shelfLevel} level.`],
    principles: ["Eye level is buy level."],
    reasoning: ["Vertical position is the cheapest exposure lever — this product earns the prime spot."],
    truthLevel: "experiment_hypothesis",
    proposedAction: `Swap ${p.name} to eye level (trading places with the current occupant) for two cheque cycles.`,
    implementationSteps: ["Identify the current eye-level occupant.", "Swap levels; change nothing else.", "Compare profit per facing for both products."],
    timing: "next reset", durationDays: 28, effort: "low",
    mechanism: "Higher unaided visibility at zero extra space.", expectedBenefitType: "gross profit per facing",
    confidence: "medium",
    evidence: [ev("Gross-profit share", pct(p.profitSharePct), "read/profit", f.period, "/health"), ev("Shelf level", p.shelfLevel!, "products", f.period, "/stock")],
    screenLink: "/stock",
    testDesign: "Level swap for two cheque cycles; primary metric gross profit per facing (both products).",
    successCriteria: ["Profit per facing rises without sinking the swapped product."],
    failureCriteria: ["The demoted product loses more than this one gains."],
    stopCondition: "Revert if combined shelf profit falls.",
  }),
};

const adjacencyFromBaskets: KnowledgePlaybook = {
  id: "adjacency-bought-together", domain: "basket",
  title: "Products bought together, displayed apart",
  principle: "If customers already buy two products together, the shelf should make that easy.",
  rationale: "Owner-confirmed co-purchase is the strongest adjacency evidence a stand without basket scanning can have; acting on it converts existing behaviour into larger baskets.",
  whenApplicable: "The owner has confirmed a bought-together pair.",
  whenNotApplicable: "No confirmed pairs (never invent basket claims).",
  conditions: "A confirmed commonly-bought-together pair exists.",
  requiredEvidence: ["owner-confirmed co-purchase pair"],
  contraindications: ["pair already adjacent"],
  mechanism: "Physical adjacency removes friction from an existing co-purchase habit.",
  actionTypes: ["improve_adjacency"], expectedBenefitType: "basket attachment",
  risks: ["negligible — reversible move"], assumptions: ["stated pairing reflects real behaviour"],
  kpis: ["attachment rate", "combined units"],
  testDesign: "Place the pair adjacent for two weeks; watch combined units vs baseline.",
  minTestDurationDays: 14, reviewCadenceDays: 14,
  successMetrics: ["combined units up"], failureMetrics: ["no change"],
  relatedPrinciples: ["profit-beside-traffic"], confidenceCeiling: "medium", basis: "owner_confirmed", version: 1,
  global: (f) => f.commonlyBoughtTogether.slice(0, 2).map(([a, b]) => draft({
    title: `Display ${a} next to ${b} — customers already pair them`, domain: "basket", type: "improve_adjacency",
    affectedProducts: [a, b], affectedProductIds: [],
    observedFacts: [`You confirmed customers commonly buy ${a} and ${b} together.`],
    principles: ["Make existing co-purchase habits physically easy."],
    reasoning: ["Confirmed co-purchase is direct adjacency evidence — the shelf should follow the basket."],
    truthLevel: "strong_inference",
    proposedAction: `Place ${a} directly beside ${b} for two weeks and watch combined units.`,
    implementationSteps: [`Move ${a} beside ${b}.`, "Change nothing else.", "Compare combined units vs the prior two weeks."],
    timing: "this week", durationDays: 14, effort: "low",
    mechanism: "Removes friction from an existing pairing habit.", expectedBenefitType: "basket attachment",
    confidence: "medium",
    evidence: [ev("Owner-confirmed pair", `${a} + ${b}`, "owner interview", f.period, "/health")],
    screenLink: "/stock",
    testDesign: "Adjacent placement for two weeks; primary metric combined units.",
    successCriteria: ["Combined units rise."], failureCriteria: ["No change after two weeks."],
    stopCondition: "Revert if either product's individual sales fall.",
  })),
};

/* ═══ OCCASIONS & SEASONALITY ════════════════════════════════════════════ */

const giftBundleOccasion: KnowledgePlaybook = {
  id: "gift-bundle-occasion", domain: "promotion",
  title: "Premium gift bundle for a confirmed occasion",
  principle: "Gifting occasions buy presentation, not price — bundle premium products instead of discounting them.",
  rationale: "A gift bundle raises basket value and sells presentation; a discount does the opposite. Only worth building when a gifting occasion is confirmed and a gift-suitable pack exists.",
  whenApplicable: "A gifting occasion is confirmed and ≥2 premium products exist.",
  whenNotApplicable: "No confirmed occasion, or no gift packaging offered (ask for it instead).",
  conditions: "customerOccasions includes gifting/eid AND ≥2 premium-tier products.",
  requiredEvidence: ["confirmed occasion", "premium products", "gift packaging (for economics)"],
  contraindications: ["no gift-suitable packaging on file"],
  mechanism: "Occasion-driven shoppers trade up to curated bundles at full margin.",
  actionTypes: ["bundle_test"], expectedBenefitType: "basket value at full margin",
  risks: ["leftover bundle stock after the occasion"], assumptions: ["occasion demand materialises as confirmed"],
  kpis: ["bundle units", "basket value"],
  testDesign: "One curated premium bundle for the occasion window only; conservative build quantity.",
  minTestDurationDays: 14, reviewCadenceDays: 14,
  successMetrics: ["bundle sells through at full margin"], failureMetrics: ["leftover bundles"],
  relatedPrinciples: ["eid-premium-packaging", "avoid-discount-strong"], confidenceCeiling: "medium", basis: "owner_confirmed", version: 1,
  global: (f) => {
    const occasion = f.customerOccasions.find((o) => /gift|eid/i.test(o));
    const premiums = f.products.filter((p) => p.tier === "premium").slice(0, 2);
    if (!occasion || premiums.length < 2) return [];
    const giftPack = f.offeredPackaging.find((k) => k.giftingSuitable);
    return [draft({
      title: `Build a ${occasion} gift bundle from ${premiums[0].name} + ${premiums[1].name}`, domain: "promotion", type: "bundle_test",
      affectedProducts: premiums.map((p) => p.name), affectedProductIds: [],
      observedFacts: [
        `You confirmed ${occasion} as a customer occasion, and ${premiums[0].name} and ${premiums[1].name} are premium tier.`,
        giftPack ? `Gift packaging on file: ${giftPack.name}${giftPack.totalUnitCost != null ? ` (${egp(giftPack.totalUnitCost)}/unit)` : ""}.` : "No gift packaging is on file yet.",
      ],
      principles: ["Gifting occasions buy presentation, not price."],
      reasoning: ["A curated premium bundle raises basket value at full margin — the opposite of a discount."],
      truthLevel: "experiment_hypothesis",
      proposedAction: `Offer one curated gift bundle for the ${occasion} window only, built conservatively.`,
      implementationSteps: ["Cost the bundle including gift packaging.", "Price at full combined margin.", "Build a small first batch.", "Track sell-through."],
      timing: `ahead of ${occasion}`, durationDays: 14, effort: "medium",
      mechanism: "Occasion shoppers trade up to curated presentation.", expectedBenefitType: "basket value at full margin",
      confidence: "medium",
      missingInformation: giftPack ? [] : ["a gift packaging format and its cost"],
      evidence: [ev("Occasion", occasion, "owner interview", f.period, "/health"), ev("Premium products", premiums.map((p) => p.name).join(", "), "products", f.period, "/stock")],
      screenLink: "/stock",
      testDesign: "Occasion-window bundle; primary metric sell-through at full margin; conservative build.",
      successCriteria: ["Bundle sells through at full margin."], failureCriteria: ["Leftover bundles after the window."],
      stopCondition: "Stop building if mid-window sell-through is weak.",
    })];
  },
};

const ramadanEveningFocus: KnowledgePlaybook = {
  id: "ramadan-evening-focus", domain: "seasonality",
  title: "Ramadan: shift weight to the evening trade",
  principle: "In Ramadan the buying day compresses into the hours after iftar — the stand should be at its fullest then.",
  rationale: "Daytime footfall collapses and the evening surge concentrates the whole day's demand; replenishment and presentation timed for the morning waste the season's rhythm.",
  whenApplicable: "Ramadan is confirmed as the active season.",
  whenNotApplicable: "Outside Ramadan.",
  conditions: "season = ramadan (owner-confirmed).",
  requiredEvidence: ["confirmed season"],
  contraindications: [],
  mechanism: "Aligning replenishment and best presentation with the post-iftar peak captures the compressed demand window.",
  actionTypes: ["review_display_space"], expectedBenefitType: "capture of the seasonal peak",
  risks: ["minimal"], assumptions: ["evening peak applies to this mall's traffic"],
  kpis: ["evening-period revenue share"],
  testDesign: "Restock + face-up before iftar daily for two weeks; compare daily revenue to the Ramadan baseline.",
  minTestDurationDays: 14, reviewCadenceDays: 14,
  successMetrics: ["daily revenue up vs early-Ramadan baseline"], failureMetrics: ["no change"],
  relatedPrinciples: ["eid-premium-packaging"], confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  global: (f) => f.season !== "ramadan" ? [] : [draft({
    title: "Time the stand for the post-iftar surge", domain: "seasonality", type: "review_display_space",
    affectedProducts: [], affectedProductIds: [],
    observedFacts: ["Ramadan is the active season — demand compresses into the evening hours."],
    principles: ["In Ramadan, the buying day starts after iftar."],
    reasoning: ["Morning-timed replenishment misses the season's real peak; the stand should be fullest and freshest at iftar."],
    truthLevel: "experiment_hypothesis",
    proposedAction: "Restock and face-up the stand shortly before iftar every day for two weeks.",
    implementationSteps: ["Shift the daily replenishment/face-up to pre-iftar.", "Keep gift/dates-adjacent products prominent.", "Compare daily revenue to the early-Ramadan baseline."],
    timing: "daily during Ramadan", durationDays: 14, effort: "low",
    mechanism: "Full presentation at the demand peak.", expectedBenefitType: "capture of the seasonal peak",
    confidence: "medium",
    evidence: [ev("Season", "Ramadan", "owner interview", f.period, "/health")],
    screenLink: "/health",
    testDesign: "Pre-iftar readiness for two weeks; primary metric daily revenue vs early-season baseline.",
    successCriteria: ["Daily revenue rises vs the baseline."], failureCriteria: ["No measurable change."],
    stopCondition: "Costless to continue; review at Eid.",
  })],
};

const weekendReadiness: KnowledgePlaybook = {
  id: "weekend-readiness", domain: "seasonality",
  title: "Weekend readiness on profit drivers",
  principle: "Never enter a confirmed peak window short on the products that earn the most.",
  rationale: "If weekends are a confirmed occasion, a profit driver running low on Thursday costs the best two selling days of the week.",
  whenApplicable: "Weekend confirmed as an occasion AND a top profit product is low/thin on cover.",
  whenNotApplicable: "No confirmed weekend pattern, or stock is healthy.",
  conditions: "customerOccasions includes weekend AND a profit driver has < 4 days cover or is flagged low.",
  requiredEvidence: ["confirmed weekend occasion", "cover / low-stock flag"],
  contraindications: ["cash cannot fund the top-up"],
  mechanism: "Pre-peak availability protects the highest-yield trading hours.",
  actionTypes: ["buy_now", "count_first"], expectedBenefitType: "protected weekend gross profit",
  risks: ["over-ordering if the weekend disappoints"], assumptions: ["weekend uplift holds as confirmed"],
  kpis: ["weekend stockouts", "weekend gross profit"],
  testDesign: "Top up before the weekend; verify no stockout and compare weekend profit.",
  minTestDurationDays: 7, reviewCadenceDays: 7,
  successMetrics: ["no weekend stockout"], failureMetrics: ["leftover excess"],
  relatedPrinciples: ["stockout-risk-profit-driver"], confidenceCeiling: "high", basis: "owner_confirmed", version: 1,
  match: (p, f) => f.customerOccasions.some((o) => /weekend/i.test(o)) && (p.profitSharePct ?? 0) >= 10 && (p.isLow || (p.daysCover != null && p.daysCover < 4)),
  build: (p, f) => draft({
    title: `Top up ${p.name} before the weekend`, domain: "seasonality", type: f.cashForPurchases == null ? "count_first" : "buy_now", product: p,
    observedFacts: [
      `Weekends are a confirmed occasion and ${p.name} (${pct(p.profitSharePct)} of gross profit) is ${p.isLow ? "flagged low" : `at ${Math.round(p.daysCover ?? 0)} days cover`}.`,
    ],
    principles: ["Never enter a confirmed peak short on your earners."],
    reasoning: ["Running out on the best trading days costs disproportionate profit."],
    truthLevel: "strong_inference",
    proposedAction: `Restock ${p.name} before Thursday so the weekend is covered.`,
    implementationSteps: ["Confirm affordable spend.", "Order enough to cover the weekend plus lead time."],
    timing: "before Thursday", durationDays: 7, effort: "low",
    mechanism: "Availability through the peak window.", expectedBenefitType: "protected weekend gross profit",
    confidence: f.cashForPurchases == null ? "medium" : "high",
    missingInformation: f.cashForPurchases == null ? ["a drawer count to confirm affordable spend"] : [],
    evidence: [ev("Occasion", "weekend (confirmed)", "owner interview", f.period, "/health"), ev("Cover", p.daysCover != null ? `${Math.round(p.daysCover)}d` : "low", "read/stock", f.period, "/stock")],
    screenLink: "/purchases",
    successCriteria: ["No weekend stockout on this product."], failureCriteria: ["Meaningful excess left after the weekend."],
    stopCondition: "Reduce the top-up if excess persists two weekends running.",
  }),
};

/* ═══ PRICING / COST ═════════════════════════════════════════════════════ */

const costPassThrough: KnowledgePlaybook = {
  id: "cost-passthrough-review", domain: "pricing",
  title: "Cost rise absorbed without a price response",
  principle: "When supplier cost moves and your price doesn't, the margin quietly pays for it.",
  rationale: "A margin drop of several points with steady demand is the signature of an unpassed cost increase; the response is a measured price review, not automatic pass-through.",
  whenApplicable: "Margin fell ≥ 4 points vs the prior period while revenue held or grew, on a non-traffic product with cost on file.",
  whenNotApplicable: "Traffic drivers (protect price; fix mix), or the drop came from mix/price cuts you made deliberately.",
  conditions: "marginDeltaPts ≤ −4, growth ≥ −5%, has cost, not a traffic driver.",
  requiredEvidence: ["margin now vs prior period", "revenue trend", "recorded cost"],
  contraindications: ["owner recently changed the price deliberately"],
  mechanism: "Restoring price to the cost curve recovers margin while demand tolerance is tested, not assumed.",
  actionTypes: ["review_price", "test_price_increase"], expectedBenefitType: "margin recovery",
  risks: ["volume loss if demand is price-sensitive"], assumptions: ["the margin drop is cost-driven, not mix-driven"],
  kpis: ["margin pts recovered", "units held"],
  testDesign: "Step the price to restore half the lost margin for two cheque cycles; watch units.",
  minTestDurationDays: 28, reviewCadenceDays: 28,
  successMetrics: ["margin recovers, units hold"], failureMetrics: ["units fall sharply"],
  relatedPrinciples: ["margin-recovery-review", "high-volume-low-margin-traffic"], confidenceCeiling: "medium", basis: "retail_math", version: 1,
  match: (p, f) => p.marginDeltaPts != null && p.marginDeltaPts <= -4 && (p.growthPct == null || p.growthPct >= -5)
    && p.hasCost && !p.ownerTrafficDriver && p.revenueSharePct < 15 && p.marginPct != null && p.marginPct < floorOf(f),
  build: (p, f) => draft({
    title: `${p.name}'s margin dropped ${Math.abs(p.marginDeltaPts!)} points — review the price against cost`, domain: "pricing", type: "review_price", product: p,
    observedFacts: [
      `${p.name}'s margin fell from ${pct((p.marginPct ?? 0) - p.marginDeltaPts!)} to ${pct(p.marginPct)} while revenue ${p.growthPct != null && p.growthPct >= 0 ? "held or grew" : "held"}.`,
      "That pattern usually means a cost increase was absorbed without a price response.",
    ],
    principles: ["Unpassed cost increases are silent margin leaks."],
    reasoning: ["Demand is steady, so the margin drop traces to cost, not customers.", "A measured price step tests tolerance instead of assuming it."],
    truthLevel: "strong_inference",
    proposedAction: `Test a price step on ${p.name} that restores about half the lost margin, for two cheque cycles.`,
    implementationSteps: ["Confirm the latest purchase cost.", "Step the price to recover ~half the lost points.", "Watch units for two cheque cycles before completing the pass-through."],
    timing: "next price update", durationDays: 28, effort: "low",
    mechanism: "Repricing to the cost curve recovers margin with demand tolerance tested.", expectedBenefitType: "margin recovery",
    confidence: "medium",
    evidence: [ev("Margin change", `${p.marginDeltaPts} pts`, "read/profit", `${f.comparePeriod}→${f.period}`, "/health")],
    screenLink: "/health",
    testDesign: "Half-step price test for two cheque cycles; primary metric margin points recovered, guardrail units.",
    successCriteria: ["Margin recovers toward its prior level and units hold."], failureCriteria: ["Units fall sharply."],
    stopCondition: "Revert the step if units drop sharply.",
  }),
};

const thresholdOffer: KnowledgePlaybook = {
  id: "threshold-offer", domain: "promotion",
  title: "Basket-threshold offer (permitted promotions only)",
  principle: "Reward bigger baskets, never smaller margins — a threshold gift beats a percentage discount.",
  rationale: "A 'spend X, get a small add-on' construction grows basket value at a known, capped cost; a % discount gives away margin on demand that already existed.",
  whenApplicable: "The hypermarket permits threshold-style offers and a low-cost add-on product exists.",
  whenNotApplicable: "No permitted promotions, or no basket evidence AND owner wants measured claims only (this stays a labelled hypothesis).",
  conditions: "allowedPromotions mentions threshold/bundle AND a cheap add-on product exists.",
  requiredEvidence: ["permitted promotion types", "an affordable add-on product"],
  contraindications: ["would be built on a % discount of a strong seller"],
  mechanism: "The threshold nudges the marginal basket up; the fixed-cost gift caps promo spend.",
  actionTypes: ["threshold_offer"], expectedBenefitType: "basket value at capped cost",
  risks: ["threshold set too low simply subsidises existing baskets"], assumptions: ["no basket data exists — the effect must be measured from daily revenue"],
  kpis: ["average daily revenue", "add-on cost per day"],
  testDesign: "Two-week threshold offer; compare average daily revenue to baseline net of gift cost.",
  minTestDurationDays: 14, reviewCadenceDays: 14,
  successMetrics: ["daily revenue up net of gift cost"], failureMetrics: ["no lift", "gift cost exceeds the lift"],
  relatedPrinciples: ["avoid-discount-strong", "dead-stock"], confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  global: (f) => {
    if (!f.allowedPromotions.some((x) => /threshold|bundle|offer/i.test(x))) return [];
    const addOn = f.products.find((p) => p.avgCost > 0 && p.avgCost <= 15 && (p.onHand ?? 0) > 0 && !protectedName(f, p));
    if (!addOn) return [];
    return [draft({
      title: `Test a spend-threshold offer with ${addOn.name} as the gift`, domain: "promotion", type: "threshold_offer",
      affectedProducts: [addOn.name], affectedProductIds: [],
      observedFacts: [
        `Threshold-style offers are permitted, and ${addOn.name} costs ${egp(addOn.avgCost)} — a capped-cost gift.`,
        "No basket data exists, so the effect is measured from daily revenue — this is a hypothesis, not a forecast.",
      ],
      principles: ["Reward bigger baskets, never smaller margins."],
      reasoning: ["A threshold gift grows the marginal basket at a known cost; a % discount gives margin away on existing demand."],
      truthLevel: "experiment_hypothesis",
      proposedAction: `Run 'spend the threshold, get a free ${addOn.name}' for two weeks; set the threshold just above the typical purchase.`,
      implementationSteps: ["Pick a threshold slightly above the common spend.", "Cap the daily gift count.", "Compare average daily revenue to baseline, net of gift cost."],
      timing: "next promotion slot", durationDays: 14, effort: "low",
      mechanism: "Threshold nudges the marginal basket up at a fixed, capped cost.", expectedBenefitType: "basket value at capped cost",
      confidence: "medium",
      missingInformation: ["basket-level data (effect measured via daily revenue instead)"],
      evidence: [ev("Permitted", f.allowedPromotions.join(", "), "owner interview", f.period, "/health"), ev("Gift cost", egp(addOn.avgCost), "read/stock", f.period, "/stock")],
      screenLink: "/health",
      testDesign: "Two-week threshold offer; primary metric average daily revenue net of gift cost.",
      successCriteria: ["Daily revenue rises by more than the gift cost."], failureCriteria: ["No lift, or gift cost exceeds the lift."],
      stopCondition: "Stop mid-test if daily gift cost exceeds the revenue lift.",
    })];
  },
};

/* ═══ CATEGORY / PORTFOLIO ═══════════════════════════════════════════════ */

const assortmentTail: KnowledgePlaybook = {
  id: "assortment-tail", domain: "category",
  title: "A long tail of products that barely sell",
  principle: "Every SKU pays rent in space and attention — a long unproductive tail dilutes both.",
  rationale: "Products below ~1% of revenue each rarely justify their facing and mental overhead; reviewing them as a group (respecting protected products) frees space for earners.",
  whenApplicable: "≥ 4 unprotected products each under 1% of revenue.",
  whenNotApplicable: "Tail products are protected, seasonal placeholders, or new listings still ramping.",
  conditions: "count(products with revenueShare < 1%, not protected) ≥ 4.",
  requiredEvidence: ["per-product revenue share", "protected flags"],
  contraindications: ["new listings still building awareness"],
  mechanism: "Consolidating the tail concentrates space and attention on products that earn.",
  actionTypes: ["discontinue_review", "reduce_exposure"], expectedBenefitType: "display productivity",
  risks: ["cutting a product with hidden basket value"], assumptions: ["tail products aren't pulling hidden traffic"],
  kpis: ["revenue per facing", "SKU count"],
  testDesign: "Review the tail list; reduce exposure of the weakest 2–3 for one stock cycle before any discontinuation.",
  minTestDurationDays: 30, reviewCadenceDays: 30,
  successMetrics: ["display productivity up, no revenue loss"], failureMetrics: ["revenue dips after reduction"],
  relatedPrinciples: ["dead-stock", "portfolio-concentration"], confidenceCeiling: "high", basis: "retail_math", version: 1,
  global: (f) => {
    const tail = f.products.filter((p) => p.revenueSharePct < 1 && p.revenue > 0 && !protectedName(f, p));
    if (tail.length < 4) return [];
    const names = tail.slice(0, 6).map((t) => t.name);
    return [draft({
      title: `${tail.length} products each sell under 1% — review the tail`, domain: "category", type: "discontinue_review",
      affectedProducts: names, affectedProductIds: [],
      observedFacts: [`${tail.length} unprotected products each contribute under 1% of revenue (${names.join(", ")}${tail.length > 6 ? "…" : ""}).`],
      principles: ["Every SKU pays rent in space and attention."],
      reasoning: ["A long unproductive tail dilutes display productivity; the space works harder under proven earners."],
      truthLevel: "measured_conclusion",
      proposedAction: "Review the tail as a group: reduce exposure of the weakest few for one stock cycle before deciding on discontinuation.",
      implementationSteps: ["Confirm none has hidden traffic value.", "Reduce the weakest 2–3 to minimal facing.", "Reassess after one stock cycle."],
      timing: "next stock cycle", durationDays: 30, effort: "medium",
      mechanism: "Concentrates space and attention on products that earn.", expectedBenefitType: "display productivity",
      confidence: "high",
      evidence: [ev("Tail size", `${tail.length} products < 1%`, "read/products", f.period, "/sales")],
      screenLink: "/stock",
      testDesign: "Reduce weakest tail exposure for one stock cycle; primary metric revenue per facing, guardrail total revenue.",
      successCriteria: ["Display productivity rises with no revenue loss."], failureCriteria: ["Total revenue dips after the reduction."],
      stopCondition: "Restore any product whose absence visibly dents revenue.",
    })];
  },
};

const protectedProductImprove: KnowledgePlaybook = {
  id: "protected-product-improve", domain: "category",
  title: "Protected product underperforming — improve, don't cut",
  principle: "A product the owner protects is a constraint, not a debate — the job becomes making it earn its place.",
  rationale: "When a do-not-discontinue product performs weakly, recommending removal is useless; repositioning, bundling or presentation is the productive lane.",
  whenApplicable: "A protected product has weak profit contribution or below-floor margin.",
  whenNotApplicable: "The protected product performs fine.",
  conditions: "doNotDiscontinue AND (profit share < 2% OR margin < floor).",
  requiredEvidence: ["owner protection flag", "profit share / margin"],
  contraindications: [],
  mechanism: "Attachment and presentation raise a protected product's yield without touching its status.",
  actionTypes: ["reposition", "bundle", "weak_as_addon"], expectedBenefitType: "yield from a protected product",
  risks: ["low"], assumptions: ["protection reflects strategic/personal value beyond the numbers"],
  kpis: ["protected product's profit contribution"],
  testDesign: "Attach it to a strong seller or reposition for two cheque cycles; compare contribution.",
  minTestDurationDays: 28, reviewCadenceDays: 28,
  successMetrics: ["contribution rises"], failureMetrics: ["no change"],
  relatedPrinciples: ["dead-stock", "weak-product-excess-facings"], confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p, f) => p.doNotDiscontinue && ((p.profitSharePct ?? 0) < 2 || (p.marginPct != null && p.marginPct < floorOf(f))),
  build: (p, f) => draft({
    title: `${p.name} is protected — make it earn its place`, domain: "category", type: "reposition", product: p,
    observedFacts: [
      `You've marked ${p.name} as not-to-be-discontinued; it currently contributes ${pct(p.profitSharePct)} of gross profit${p.marginPct != null ? ` at a ${pct(p.marginPct)} margin` : ""}.`,
    ],
    principles: ["A protected product is a constraint — improve it, don't debate it."],
    reasoning: ["Since removal is off the table, attachment and presentation are the levers that raise its yield."],
    truthLevel: "measured_conclusion",
    proposedAction: `Reposition ${p.name} beside a strong seller (or into a bundle) for two cheque cycles instead of leaving it to underperform.`,
    implementationSteps: ["Pick the strongest compatible neighbour.", "Move or bundle it.", "Compare its contribution after two cheque cycles."],
    timing: "next reset", durationDays: 28, effort: "low",
    mechanism: "Attachment raises yield without touching the product's protected status.", expectedBenefitType: "yield from a protected product",
    confidence: "medium",
    evidence: [ev("Protected", "do not discontinue (owner)", "owner interview", f.period, "/stock"), ev("Profit share", pct(p.profitSharePct), "read/profit", f.period, "/health")],
    screenLink: "/stock",
    testDesign: "Reposition/bundle for two cheque cycles; primary metric its profit contribution.",
    successCriteria: ["Its contribution rises."], failureCriteria: ["No change after two cycles."],
    stopCondition: "Try a different neighbour if the first attachment does nothing.",
  }),
};

const supplierConcentration: KnowledgePlaybook = {
  id: "supplier-concentration", domain: "supplier",
  title: "Inventory concentrated in one supplier",
  principle: "A single supplier holding most of your inventory value is a supply and price-negotiation risk.",
  rationale: "Concentration weakens your negotiating position and exposes the stand to one supplier's price moves or delays; a priced alternative source is cheap insurance.",
  whenApplicable: "One vendor accounts for > 60% of known inventory value.",
  whenNotApplicable: "Vendor data too sparse to judge.",
  conditions: "max vendor share of inventory value > 60% with ≥ 5 vendor-tagged products.",
  requiredEvidence: ["per-product vendor + inventory value"],
  contraindications: ["the supplier is contractually exclusive"],
  mechanism: "A qualified second source restores negotiating leverage and delivery resilience.",
  actionTypes: ["negotiate_tier", "collect_evidence"], expectedBenefitType: "supply resilience + cost leverage",
  risks: ["second source may quote worse initially"], assumptions: ["alternatives exist for the category"],
  kpis: ["vendor share of inventory value", "unit cost trend"],
  testDesign: "Price 2–3 top products with an alternative supplier; compare landed cost and lead time.",
  minTestDurationDays: 21, reviewCadenceDays: 60,
  successMetrics: ["credible second quote obtained"], failureMetrics: ["no viable alternative"],
  relatedPrinciples: ["supplier-quantity-break"], confidenceCeiling: "high", basis: "retail_math", version: 1,
  global: (f) => {
    const byVendor = new Map<string, number>();
    let known = 0;
    let tagged = 0;
    for (const p of f.products) {
      if (!p.vendor || p.inventoryValue == null) continue;
      byVendor.set(p.vendor, (byVendor.get(p.vendor) ?? 0) + p.inventoryValue);
      known += p.inventoryValue; tagged += 1;
    }
    if (tagged < 5 || known <= 0) return [];
    const [topVendor, topValue] = [...byVendor.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = (topValue / known) * 100;
    if (share <= 60) return [];
    return [draft({
      title: `${topVendor} holds ${Math.round(share)}% of your inventory value`, domain: "supplier", type: "collect_evidence",
      affectedProducts: [], affectedProductIds: [],
      observedFacts: [`${topVendor} supplies ${Math.round(share)}% of known inventory value (${egp(topValue)}).`],
      principles: ["Concentration weakens negotiation and resilience."],
      reasoning: ["One supplier's price move or delay currently hits most of the stand at once."],
      truthLevel: "measured_conclusion",
      proposedAction: `Price your top 2–3 ${topVendor} products with an alternative supplier — leverage, even if you never switch.`,
      implementationSteps: ["Pick the top products by spend.", "Get a written alternative quote with lead time.", "Use it in the next negotiation."],
      timing: "this month", durationDays: 21, effort: "medium",
      mechanism: "A credible second source restores leverage and resilience.", expectedBenefitType: "supply resilience + cost leverage",
      confidence: "high",
      evidence: [ev("Vendor share", `${Math.round(share)}%`, "read/stock", f.period, "/stock")],
      screenLink: "/purchases",
      testDesign: "Obtain alternative quotes; primary metric a credible second quote on file.",
      successCriteria: ["A credible alternative quote exists."], failureCriteria: ["No viable alternative found."],
      stopCondition: null,
    })];
  },
};

/* ═══ PURCHASING / CASH ══════════════════════════════════════════════════ */

const leadTimeReorder: KnowledgePlaybook = {
  id: "lead-time-reorder", domain: "purchase",
  title: "Cover is shorter than the supplier's lead time",
  principle: "The reorder point is lead time, not zero — order when cover approaches delivery time, not when the shelf empties.",
  rationale: "If delivery takes longer than remaining cover, a stockout is already booked even if the shelf looks fine today.",
  whenApplicable: "Recorded supplier lead time exceeds current days of cover on a selling product.",
  whenNotApplicable: "Lead time unknown (ask), or the product is being deliberately run down.",
  conditions: "supplierLeadDays > daysCover, product selling, inventory tracked.",
  requiredEvidence: ["supplier lead time", "days of cover"],
  contraindications: ["deliberate run-down (pause/discontinue in progress)"],
  mechanism: "Ordering at the lead-time boundary keeps availability continuous without holding excess.",
  actionTypes: ["buy_now", "buy_after_cheque"], expectedBenefitType: "availability without excess",
  risks: ["cash timing"], assumptions: ["velocity holds during lead time"],
  kpis: ["stockout days", "cover at delivery"],
  testDesign: "Order to target cover now; verify no stockout before delivery.",
  minTestDurationDays: 7, reviewCadenceDays: 14,
  successMetrics: ["no stockout before delivery"], failureMetrics: ["stockout despite order"],
  relatedPrinciples: ["cheque-cycle-purchasing", "overstock-vs-cover"], confidenceCeiling: "high", basis: "retail_math", version: 1,
  match: (p, f) => f.inventoryTracked && p.supplierLeadDays != null && p.daysCover != null && p.daysCover < p.supplierLeadDays && (p.velocityPerDay ?? 0) > 0,
  build: (p, f) => {
    const short = f.cashForPurchases != null && f.cashForPurchases <= 0;
    return draft({
      title: `Order ${p.name} now — cover is inside the lead time`, domain: "purchase", type: short ? "buy_after_cheque" : "buy_now", product: p,
      observedFacts: [`${p.name} has ${Math.round(p.daysCover!)} days of cover but delivery takes ${p.supplierLeadDays} days — the stockout is already scheduled.`],
      principles: ["The reorder point is lead time, not zero."],
      reasoning: ["Waiting until the shelf runs low guarantees empty days equal to the lead-time gap."],
      truthLevel: "measured_conclusion",
      proposedAction: short
        ? `Place the ${p.name} order to land right after the next cheque (${f.nextChequeEta ?? "expected settlement"}) — the gap is already unavoidable, minimise it.`
        : `Place the ${p.name} order today to target cover.`,
      implementationSteps: ["Confirm current velocity.", "Order to target cover.", short ? "Time payment to the cheque." : "Confirm affordability against the reserve."],
      timing: short ? "at the next cheque" : "today", durationDays: 7, effort: "low",
      mechanism: "Ordering at the lead-time boundary keeps availability continuous.", expectedBenefitType: "availability without excess",
      confidence: "high",
      evidence: [ev("Cover", `${Math.round(p.daysCover!)}d`, "read/stock", f.period, "/stock"), ev("Lead time", `${p.supplierLeadDays}d`, "owner interview", f.period, "/purchases")],
      screenLink: "/purchases",
      successCriteria: ["No stockout before delivery."], failureCriteria: ["Stockout despite the order."],
      stopCondition: null,
    });
  },
};

const moqCashConflict: KnowledgePlaybook = {
  id: "moq-cash-conflict", domain: "purchase",
  title: "Minimum order quantity exceeds affordable cash",
  principle: "Never let a supplier's MOQ breach your reserve — split, defer to the cheque, or negotiate before you comply.",
  rationale: "An MOQ that costs more than verified affordable cash forces a choice the owner should make deliberately, not by default at the counter.",
  whenApplicable: "A needed product's MOQ × unit cost exceeds verified affordable spend.",
  whenNotApplicable: "Cash unknown (count first), or the product isn't needed soon.",
  conditions: "restock needed (low/thin cover) AND minOrderQty × avgCost > cashForPurchases (known).",
  requiredEvidence: ["MOQ", "unit cost", "verified affordable cash"],
  contraindications: [],
  mechanism: "Timing the committed spend to the cheque (or splitting) preserves the reserve while meeting the MOQ.",
  actionTypes: ["buy_after_cheque", "split_orders", "negotiate_tier"], expectedBenefitType: "reserve protection",
  risks: ["short availability gap until the cheque"], assumptions: ["cheque arrives near its ETA"],
  kpis: ["reserve floor held", "stockout days"],
  testDesign: "Defer the MOQ order to the cheque date; verify the reserve held and measure any availability gap.",
  minTestDurationDays: 14, reviewCadenceDays: 14,
  successMetrics: ["reserve intact, gap minimal"], failureMetrics: ["extended stockout"],
  relatedPrinciples: ["cheque-cycle-purchasing", "supplier-quantity-break"], confidenceCeiling: "high", basis: "retail_math", version: 1,
  match: (p, f) => f.cashForPurchases != null && p.minOrderQty != null && p.avgCost > 0
    && (p.isLow || (p.daysCover != null && p.daysCover < 10))
    && p.minOrderQty * p.avgCost > f.cashForPurchases,
  build: (p, f) => draft({
    title: `${p.name}'s minimum order (${egp(p.minOrderQty! * p.avgCost)}) exceeds affordable cash`, domain: "purchase", type: "buy_after_cheque", product: p,
    observedFacts: [
      `${p.name} needs restocking, but the supplier MOQ of ${p.minOrderQty} units costs ${egp(p.minOrderQty! * p.avgCost)} against ${egp(f.cashForPurchases!)} of verified affordable spend.`,
    ],
    principles: ["Never let an MOQ breach the reserve by default."],
    reasoning: ["Complying today would eat into the cash floor; the cheque is the natural funding point."],
    truthLevel: "measured_conclusion",
    proposedAction: `Schedule the ${p.name} MOQ order for just after the next cheque${f.nextChequeEta ? ` (~${f.nextChequeEta})` : ""}, or ask the supplier to split the quantity.`,
    implementationSteps: ["Ask the supplier about a split delivery first.", "Otherwise place the order timed to the cheque.", "Bridge any gap with the remaining stock."],
    timing: f.nextChequeEta ? `around ${f.nextChequeEta}` : "at the next settlement", durationDays: 14, effort: "low",
    mechanism: "Times the committed spend to the settlement inflow.", expectedBenefitType: "reserve protection",
    confidence: "high",
    evidence: [ev("MOQ cost", egp(p.minOrderQty! * p.avgCost), "owner interview", f.period, "/purchases"), ev("Affordable now", egp(f.cashForPurchases!), "cash engine", f.period, "/money")],
    screenLink: "/purchases",
    successCriteria: ["Reserve floor held; availability gap under a week."], failureCriteria: ["Extended stockout while waiting."],
    stopCondition: "If the gap exceeds a week, revisit with the supplier.",
  }),
};

const trafficDriverAvailability: KnowledgePlaybook = {
  id: "traffic-driver-availability", domain: "inventory",
  title: "Owner-confirmed traffic driver running low",
  principle: "A traffic product's job is being there — its stockout costs the whole stand's footfall, not just its own sales.",
  rationale: "The owner has flagged this product as the reason customers come; availability outranks its own margin math.",
  whenApplicable: "An owner-flagged traffic driver is low or under a week of cover.",
  whenNotApplicable: "Stock is healthy.",
  conditions: "ownerTrafficDriver AND (isLow OR daysCover < 7).",
  requiredEvidence: ["owner traffic flag", "cover / low flag"],
  contraindications: [],
  mechanism: "Guaranteed availability of the footfall anchor protects every attached sale.",
  actionTypes: ["buy_now", "count_first"], expectedBenefitType: "protected footfall",
  risks: ["cash timing"], assumptions: ["traffic role holds as confirmed"],
  kpis: ["traffic product stockout days"],
  testDesign: "Restock immediately; track that no stockout occurs.",
  minTestDurationDays: 7, reviewCadenceDays: 7,
  successMetrics: ["no stockout"], failureMetrics: ["stockout"],
  relatedPrinciples: ["stockout-risk-profit-driver", "high-volume-low-margin-traffic"], confidenceCeiling: "high", basis: "owner_confirmed", version: 1,
  match: (p) => p.ownerTrafficDriver && (p.isLow || (p.daysCover != null && p.daysCover < 7)),
  build: (p, f) => draft({
    title: `Keep ${p.name} in stock — it brings the customers in`, domain: "inventory", type: f.cashForPurchases == null ? "count_first" : "buy_now", product: p,
    observedFacts: [`You flagged ${p.name} as a traffic driver and it's ${p.isLow ? "low" : `at ${Math.round(p.daysCover ?? 0)} days cover`}.`],
    principles: ["A traffic product's job is being there."],
    reasoning: ["Its stockout costs the stand's footfall and every attached sale, not just its own revenue."],
    truthLevel: "strong_inference",
    proposedAction: `Restock ${p.name} ahead of everything else this cycle.`,
    implementationSteps: ["Confirm affordable spend.", "Order to target cover before other purchases."],
    timing: "this week", durationDays: 7, effort: "low",
    mechanism: "Availability of the footfall anchor protects attached sales.", expectedBenefitType: "protected footfall",
    confidence: f.cashForPurchases == null ? "medium" : "high",
    missingInformation: f.cashForPurchases == null ? ["a drawer count to confirm affordable spend"] : [],
    evidence: [ev("Traffic driver", "owner-confirmed", "owner interview", f.period, "/stock"), ev("Cover", p.daysCover != null ? `${Math.round(p.daysCover)}d` : "low", "read/stock", f.period, "/stock")],
    screenLink: "/purchases",
    successCriteria: ["No stockout on the traffic driver."], failureCriteria: ["A stockout occurs."],
    stopCondition: null,
  }),
};

/* ═══ PACKAGING / TRIAL ══════════════════════════════════════════════════ */

const samplingTrial: KnowledgePlaybook = {
  id: "sampling-trial", domain: "packaging",
  title: "High-margin premium product that too few customers try",
  principle: "For premium food, the first taste is the best salesman — lower the trial barrier, not the price.",
  rationale: "A premium product with strong margin but infrequent sales usually has an awareness/trial problem, not a price problem; a tiny sampling pack recruits first-time buyers at controlled cost.",
  whenApplicable: "Premium tier, margin at/above floor, sells on few days relative to the period.",
  whenNotApplicable: "Margin below floor (fix margin first), or already sells frequently.",
  conditions: "tier premium, margin ≥ floor, daysSold < 40% of period days proxy (daysSold < 12).",
  requiredEvidence: ["tier", "margin", "selling-day frequency", "sampling pack cost (for economics)"],
  contraindications: ["no sampling-suitable pack and owner unwilling to create one"],
  mechanism: "A low-cost taste converts hesitant premium buyers without touching the price architecture.",
  actionTypes: ["smaller_entry_size"], expectedBenefitType: "premium trial recruitment",
  risks: ["sampling cost with no conversion"], assumptions: ["trial is the barrier, not taste or price"],
  kpis: ["new-buyer frequency (daysSold)", "units after trial period"],
  testDesign: "Offer a tiny taster pack beside the product for two cheque cycles; compare selling-day frequency after.",
  minTestDurationDays: 28, reviewCadenceDays: 28,
  successMetrics: ["selling-day frequency rises"], failureMetrics: ["no frequency change"],
  relatedPrinciples: ["premium-entry-size", "premium-weak-presentation"], confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p, f) => p.tier === "premium" && p.marginPct != null && p.marginPct >= floorOf(f) && p.daysSold > 0 && p.daysSold < 12,
  build: (p, f) => draft({
    title: `Too few customers try ${p.name} — test a taster pack`, domain: "packaging", type: "smaller_entry_size", product: p,
    observedFacts: [
      `${p.name} carries a healthy ${pct(p.marginPct)} margin but sold on only ${p.daysSold} day(s) this period — a trial problem, not a price problem.`,
    ],
    principles: ["For premium food, the first taste is the best salesman."],
    reasoning: ["Strong margin with infrequent purchase points to an awareness/trial barrier; sampling attacks that directly."],
    truthLevel: "experiment_hypothesis",
    proposedAction: `Offer a tiny taster pack of ${p.name} beside the main facing for two cheque cycles.`,
    implementationSteps: ["Cost a minimal taster pack.", "Place beside the main facing.", "Compare selling-day frequency after the window."],
    timing: "next reset", durationDays: 28, effort: "medium",
    mechanism: "A low-cost taste recruits first-time premium buyers without touching price.", expectedBenefitType: "premium trial recruitment",
    confidence: "medium",
    missingInformation: [f.offeredPackaging.some((k) => k.type === "sampling") ? "" : "a sampling pack format and its cost"].filter(Boolean),
    evidence: [ev("Selling days", `${p.daysSold}`, "read/products", f.period, "/sales"), ev("Margin", pct(p.marginPct), "read/profit", f.period, "/health")],
    screenLink: "/stock",
    testDesign: "Taster pack beside the product for two cheque cycles; primary metric selling-day frequency.",
    successCriteria: ["Selling-day frequency rises after the trial window."], failureCriteria: ["No frequency change."],
    stopCondition: "Stop if sampling cost runs with zero conversion after one cycle.",
  }),
};

const newProductEvidence: KnowledgePlaybook = {
  id: "new-product-evidence", domain: "operational",
  title: "Too early to judge — collect evidence first",
  principle: "Never draw portfolio conclusions from a handful of selling days — discipline beats reaction.",
  rationale: "A product with only a few observed selling days will look random; acting on it (up or down) is noise-chasing. The correct action is a defined observation window.",
  whenApplicable: "A product sold on 1–4 days this period and has no prior-period history.",
  whenNotApplicable: "Established products with history.",
  conditions: "daysSold between 1 and 4 AND no comparison-period revenue.",
  requiredEvidence: ["selling days", "absence of prior history"],
  contraindications: [],
  mechanism: "A fixed observation window prevents premature kill/scale decisions.",
  actionTypes: ["collect_evidence"], expectedBenefitType: "decision quality",
  risks: ["none"], assumptions: [],
  kpis: ["decision made on ≥ 3 weeks of data"],
  testDesign: "Hold changes for three weeks; then judge with the standard playbooks.",
  minTestDurationDays: 21, reviewCadenceDays: 21,
  successMetrics: ["a grounded decision after the window"], failureMetrics: [],
  relatedPrinciples: ["assortment-tail"], confidenceCeiling: "high", basis: "retail_math", version: 1,
  match: (p) => p.daysSold >= 1 && p.daysSold <= 4 && p.growthPct == null,
  build: (p, f) => draft({
    title: `${p.name} is too new to judge — hold changes for three weeks`, domain: "operational", type: "collect_evidence", product: p,
    observedFacts: [`${p.name} has only ${p.daysSold} selling day(s) on record and no prior-period history.`],
    principles: ["Never draw portfolio conclusions from a handful of days."],
    reasoning: ["With this little data any pattern is noise; a fixed window prevents a premature call in either direction."],
    truthLevel: "measured_conclusion",
    proposedAction: `Make no portfolio or pricing change to ${p.name} for three weeks; then judge it with full playbooks.`,
    implementationSteps: ["Keep price and placement stable.", "Re-run the strategist after three weeks of data."],
    timing: "now", durationDays: 21, effort: "low",
    mechanism: "A fixed observation window prevents noise-chasing.", expectedBenefitType: "decision quality",
    confidence: "high",
    evidence: [ev("Selling days", `${p.daysSold}`, "read/products", f.period, "/sales")],
    screenLink: "/sales",
    successCriteria: ["A grounded decision after the window."], failureCriteria: [],
    stopCondition: null,
  }),
};

/** The executive expansion pack. */
export const EXECUTIVE_KNOWLEDGE: KnowledgePlaybook[] = [
  eyeLevelProfitDriver, adjacencyFromBaskets,
  giftBundleOccasion, ramadanEveningFocus, weekendReadiness,
  costPassThrough, thresholdOffer,
  assortmentTail, protectedProductImprove, supplierConcentration,
  leadTimeReorder, moqCashConflict, trafficDriverAvailability,
  samplingTrial, newProductEvidence,
];
