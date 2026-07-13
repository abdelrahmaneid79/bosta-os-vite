/** RETAIL KNOWLEDGE LIBRARY (Cycle 10) — a typed set of FMCG playbooks, NOT a
 *  prompt file. Each carries its principle, conditions, required evidence,
 *  contraindications, mechanism, test design and metrics, plus its deterministic
 *  `match`/`build` (or portfolio-level `global`). Every entry labels its BASIS
 *  (retail math / owner-confirmed / heuristic / prior Bosta experiment) so a
 *  general heuristic is never presented as already proven for Bosta Bites.
 *
 *  ~24 high-quality playbooks covering the most valuable situations. Thresholds
 *  are documented inline; owner targets override defaults where available. */
import type { KnowledgePlaybook, RetailBusinessFacts } from "./contract";
import { draft, ev, egp, pct } from "./helpers";

const floorOf = (f: RetailBusinessFacts) => f.marginFloorPct ?? 30;
const coverMax = (f: RetailBusinessFacts) => f.maxCoverDays ?? 45;
const coverageOk = (f: RetailBusinessFacts) => (f.coveragePct ?? 0) >= 60;

/* ═══ INVENTORY / PORTFOLIO ═══════════════════════════════════════════════ */

const highValueSlowMover: KnowledgePlaybook = {
  id: "high-value-slow-mover", domain: "inventory",
  title: "High inventory value, weak profit contribution",
  principle: "Capital tied up in slow, low-profit stock is capital denied to your profit drivers.",
  conditions: "Product holds a large share of inventory value but a small share of gross profit, and is not growing.",
  requiredEvidence: ["inventory value share", "gross-profit share", "sales trend"],
  contraindications: ["strategic/traffic product", "seasonal build-up ahead of a known event"],
  mechanism: "Freeing capital from dead weight lets you fund faster-turning, higher-margin stock.",
  actionTypes: ["pause_purchasing", "reduce_exposure"],
  expectedBenefitType: "working-capital efficiency", risks: ["stockout if demand returns"],
  testDesign: "Stop reordering; run down existing stock; review at next count.",
  minTestDurationDays: 21, successMetrics: ["inventory value share falls", "cover returns to range"],
  failureMetrics: ["stockouts on returning demand"], confidenceCeiling: "high",
  basis: "retail_math", version: 1,
  match: (p, f) => p.inventorySharePct != null && p.inventorySharePct >= 8 && (p.profitSharePct ?? 0) <= 3
    && !f.strategicProducts.includes(p.name) && (p.growthPct == null || p.growthPct <= 0),
  build: (p, f) => draft({
    title: `Don't buy more ${p.name} yet — capital is trapped`, domain: "inventory", type: "pause_purchasing", product: p,
    observedFacts: [
      `${p.name} holds ${pct(p.inventorySharePct)} of recorded inventory value but produced only ${pct(p.profitSharePct)} of gross profit this period.`,
      p.daysCover != null ? `Days of cover is ${Math.round(p.daysCover)} vs your ${coverMax(f)}-day target.` : "Days of cover isn't computed yet.",
      p.growthPct != null ? `Revenue trend ${p.growthPct >= 0 ? "up" : "down"} ${pct(Math.abs(p.growthPct))} vs the comparison period.` : "",
    ].filter(Boolean),
    principles: ["Working capital should sit in fast, high-margin stock, not dead weight."],
    reasoning: [
      "High inventory-value share with low profit share means money is parked, not working.",
      "With flat-to-declining sales, buying more deepens the trap.",
    ],
    truthLevel: coverageOk(f) && f.inventoryTracked ? "measured_conclusion" : "strong_inference",
    proposedAction: `Use existing ${p.name} stock before placing another order.`,
    implementationSteps: ["Pause the next purchase of this product.", "Sell through current stock.", "Re-evaluate after the next physical count or when cover falls below your threshold."],
    timing: "immediately", durationDays: 21, effort: "low",
    mechanism: "Runs down over-invested stock and frees cash for faster movers.",
    expectedBenefitType: "working-capital efficiency",
    financialImpactEgp: p.inventoryValue != null ? Math.round(p.inventoryValue) : null,
    risks: ["Stockout if demand unexpectedly returns."],
    contraindications: [f.strategicProducts.includes(p.name) ? "Owner-flagged strategic product." : ""].filter(Boolean),
    confidence: coverageOk(f) && f.inventoryTracked ? "high" : "medium",
    evidence: [
      ev("Inventory value share", pct(p.inventorySharePct), "read/stock", f.period, "/stock"),
      ev("Gross-profit share", pct(p.profitSharePct), "read/profit", f.period, "/health"),
    ],
    screenLink: "/purchases",
    baselineMetrics: [`inventory value ${p.inventoryValue != null ? egp(p.inventoryValue) : "unknown"}`, `cover ${p.daysCover != null ? Math.round(p.daysCover) + "d" : "unknown"}`],
    successCriteria: ["Inventory-value share drops toward the profit share.", "Cover returns to your target range."],
    failureCriteria: ["Repeated stockouts as demand returns."],
    stopCondition: "Cover falls below your stockout tolerance — resume normal ordering.",
    missingInformation: f.inventoryTracked ? [] : ["a stock count to confirm on-hand inventory"],
  }),
};

const deadStock: KnowledgePlaybook = {
  id: "dead-stock", domain: "inventory",
  title: "Dead stock — on hand but not selling",
  principle: "Stock that doesn't move is a cost, not an asset; convert it or clear it.",
  conditions: "Product has on-hand stock but effectively no sales in the period.",
  requiredEvidence: ["on-hand quantity", "period sales"],
  contraindications: ["just restocked", "new listing still ramping"],
  mechanism: "Bundling dead stock as an add-on recovers cash without discounting a strong product.",
  actionTypes: ["discontinue_review", "weak_as_addon", "bundle"],
  expectedBenefitType: "cash recovery", risks: ["margin dilution if over-discounted"],
  testDesign: "Attach as a low-price add-on to a strong seller for two weeks.",
  minTestDurationDays: 14, successMetrics: ["dead units clear"], failureMetrics: ["no movement", "drags the anchor product"],
  confidenceCeiling: "high", basis: "retail_math", version: 1,
  match: (p, f) => (p.onHand ?? 0) > 0 && p.daysSold === 0 && f.inventoryTracked && !f.strategicProducts.includes(p.name),
  build: (p, f) => draft({
    title: `${p.name} is dead stock — convert or clear it`, domain: "inventory", type: "weak_as_addon", product: p,
    observedFacts: [`${p.name} has ${Math.round(p.onHand ?? 0)} on hand but recorded no sales this period.`],
    principles: ["Non-moving stock is a carrying cost; recover cash rather than protect it."],
    reasoning: ["On-hand with zero sales ties up cash and shelf space.", "Using it as an add-on avoids discounting a healthy product."],
    truthLevel: "measured_conclusion",
    proposedAction: p.doNotDiscontinue
      ? `Offer ${p.name} as a low-price add-on to a strong seller to move the stock. (You've flagged it do-not-discontinue, so BostaOS won't propose dropping it.)`
      : `Offer ${p.name} as a low-price add-on to a strong seller, or review for discontinuation.`,
    implementationSteps: p.doNotDiscontinue
      ? ["Pick a strong anchor product.", "Offer this as a small add-on for two weeks.", "Keep presentation quality — it stays in the range."]
      : ["Pick a strong anchor product.", "Offer this as a small add-on for two weeks.", "If it still doesn't move, plan discontinuation."],
    contraindications: p.doNotDiscontinue ? ["Owner-flagged do-not-discontinue — clear stock, don't drop the product."] : [],
    timing: "this week", durationDays: 14, effort: "low",
    mechanism: "Attachment to a mover recovers cash without cutting a strong product's price.",
    expectedBenefitType: "cash recovery",
    confidence: "high",
    evidence: [ev("On hand", `${Math.round(p.onHand ?? 0)}`, "read/stock", f.period, "/stock"), ev("Units sold", "0", "read/products", f.period, "/sales")],
    screenLink: "/stock",
    successCriteria: ["The dead units clear within the window."], failureCriteria: ["No movement; the anchor product's sales dip."],
    stopCondition: "If the add-on drags the anchor, stop and plan discontinuation.",
  }),
};

const overstockVsCover: KnowledgePlaybook = {
  id: "overstock-vs-cover", domain: "purchase",
  title: "Cover above target — don't over-order",
  principle: "Buying beyond your cover target converts cash into shelf risk.",
  conditions: "Days of cover exceeds the configured maximum.",
  requiredEvidence: ["days of cover", "max-cover target"],
  contraindications: ["confirmed seasonal build-up", "supplier gap ahead"],
  mechanism: "Holding to target keeps cash liquid and reduces waste/obsolescence.",
  actionTypes: ["avoid_exceed_cover", "reduce_next_order"],
  expectedBenefitType: "cash preservation", risks: ["stockout if lead time lengthens"],
  testDesign: "Skip/shrink the next order; hold to target cover.",
  minTestDurationDays: 14, successMetrics: ["cover returns to range"], failureMetrics: ["stockout"],
  confidenceCeiling: "high", basis: "retail_math", version: 1,
  match: (p, f) => p.daysCover != null && p.daysCover > coverMax(f) * 1.3 && f.inventoryTracked,
  build: (p, f) => draft({
    title: `Reduce the next ${p.name} order — cover is high`, domain: "purchase", type: "avoid_exceed_cover", product: p,
    observedFacts: [`${p.name} has ${Math.round(p.daysCover!)} days of cover against your ${coverMax(f)}-day target.`],
    principles: ["Order to your cover target; excess cover is trapped cash."],
    reasoning: ["Cover well above target means the shelf is already funded."],
    truthLevel: "measured_conclusion",
    proposedAction: `Skip or shrink the next ${p.name} order until cover falls back to target.`,
    implementationSteps: ["Reduce or skip the next order.", "Resume normal ordering when cover reaches your target."],
    timing: "next order cycle", durationDays: 14, effort: "low",
    mechanism: "Keeps cash liquid and reduces obsolescence risk.", expectedBenefitType: "cash preservation",
    confidence: "high",
    evidence: [ev("Days of cover", `${Math.round(p.daysCover!)}`, "read/stock", f.period, "/stock")],
    screenLink: "/purchases",
    successCriteria: ["Cover returns to your target band."], failureCriteria: ["A stockout before the next replenishment."],
    stopCondition: "Cover falls below target — resume ordering.",
  }),
};

const stockoutRiskProfitDriver: KnowledgePlaybook = {
  id: "stockout-risk-profit-driver", domain: "inventory",
  title: "Stockout risk on a profit driver",
  principle: "Never starve your profit engine — protect availability of top-profit products first.",
  conditions: "A high gross-profit-share product is low on stock or below cover.",
  requiredEvidence: ["gross-profit share", "on-hand / cover"],
  contraindications: ["cash cannot cover the order", "supplier unavailable"],
  mechanism: "Protecting availability of a proven profit driver defends the margin base.",
  actionTypes: ["buy_now", "count_first", "buy_after_cheque"],
  expectedBenefitType: "protected gross profit", risks: ["cash strain if timed poorly"],
  testDesign: "Restock to target cover; confirm affordability against reserve.",
  minTestDurationDays: 7, successMetrics: ["no stockout", "profit share held"], failureMetrics: ["reserve breached"],
  confidenceCeiling: "high", basis: "retail_math", version: 1,
  match: (p, f) => (p.profitSharePct ?? 0) >= 12 && (p.isLow || (p.daysCover != null && p.daysCover < 7)) && f.inventoryTracked,
  build: (p, f) => {
    const affordable = f.cashForPurchases == null ? null : f.cashForPurchases > 0;
    const type = affordable === false ? "buy_after_cheque" : affordable == null ? "count_first" : "buy_now";
    return draft({
      title: `Protect ${p.name} availability — it's a profit driver`, domain: "inventory", type, product: p,
      observedFacts: [
        `${p.name} contributes ${pct(p.profitSharePct)} of gross profit and is ${p.isLow ? "flagged low" : `at ${Math.round(p.daysCover ?? 0)} days cover`}.`,
        f.cashForPurchases != null ? `Verified affordable spend right now: ${egp(f.cashForPurchases)}.` : "Affordable spend is unknown until the drawer is counted.",
      ],
      principles: ["Defend the availability of proven profit drivers before anything else."],
      reasoning: ["A stockout here removes your best margin per shelf slot.", affordable === false ? "Cash is tight, so time the buy to the cheque." : "Restock to target if affordable."],
      truthLevel: "strong_inference",
      proposedAction: affordable === false ? `Plan the ${p.name} restock for just after the next cheque (${f.nextChequeEta ?? "expected settlement"}).` : affordable == null ? `Count the drawer, then restock ${p.name} to target cover.` : `Restock ${p.name} to target cover now.`,
      implementationSteps: affordable === false ? ["Hold the order until the cheque clears.", "Restock to target once cash lands."] : ["Confirm affordable spend.", "Order to target cover."],
      timing: affordable === false ? `around ${f.nextChequeEta ?? "the next cheque"}` : "this week", durationDays: 7, effort: "low",
      mechanism: "Availability of the profit driver protects the margin base.", expectedBenefitType: "protected gross profit",
      confidence: affordable == null ? "medium" : "high",
      evidence: [ev("Gross-profit share", pct(p.profitSharePct), "read/profit", f.period, "/health"), ev("Cover", p.daysCover != null ? `${Math.round(p.daysCover)}d` : "low", "read/stock", f.period, "/stock")],
      screenLink: "/purchases",
      missingInformation: f.cashForPurchases == null ? ["a drawer count to confirm affordable spend"] : [],
      successCriteria: ["No stockout; profit share holds."], failureCriteria: ["Reserve floor breached to fund the order."],
      stopCondition: "If the order would breach your reserve, defer to the cheque.",
    });
  },
};

/* ═══ MERCHANDISING ═══════════════════════════════════════════════════════ */

const profitDriverLowSpace: KnowledgePlaybook = {
  id: "profit-driver-low-space", domain: "shelf",
  title: "Strong profit driver, insufficient space",
  principle: "Give your best gross-profit-per-slot products more of the shelf.",
  conditions: "A high-profit-share product has few facings (or facings unknown).",
  requiredEvidence: ["gross-profit share", "facings (to be exact)"],
  contraindications: ["already dominant facings", "stock can't support more space"],
  mechanism: "More facings for a proven profit driver lifts profit per display position.",
  actionTypes: ["increase_facings", "review_display_space"],
  expectedBenefitType: "gross profit per display position", risks: ["cannibalising another strong line"],
  testDesign: "Add one facing for two cheque cycles; compare profit per position.",
  minTestDurationDays: 28, successMetrics: ["profit per position up"], failureMetrics: ["no lift", "hurts neighbour"],
  confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p) => (p.profitSharePct ?? 0) >= 15,
  build: (p, f) => {
    const knowsFacings = p.facings != null;
    return draft({
      title: `Give ${p.name} more shelf space`, domain: "shelf", type: knowsFacings ? "increase_facings" : "review_display_space", product: p,
      observedFacts: [
        `${p.name} drives ${pct(p.profitSharePct)} of gross profit${p.revenueSharePct ? ` on ${pct(p.revenueSharePct)} of revenue` : ""}.`,
        knowsFacings ? `It currently has ${p.facings} facing(s).` : "Facings for this product aren't recorded yet.",
      ],
      principles: ["Shelf space should follow gross profit per position, not just volume."],
      reasoning: ["A top profit contributor earns more room.", knowsFacings ? "With few facings, it's likely under-exposed." : "Without facings data, this is a space review, not an exact move."],
      truthLevel: "experiment_hypothesis",
      proposedAction: knowsFacings ? `Add one facing to ${p.name} and test for two cheque cycles.` : `Review ${p.name}'s display space — record its facings so the move can be exact.`,
      implementationSteps: knowsFacings ? ["Add one facing, taken from a weak neighbour.", "Hold for two cheque cycles.", "Compare gross profit per position."] : ["Record current facings/zone for this product.", "Then re-run the recommendation for an exact move."],
      timing: "next reset", durationDays: 28, effort: "medium",
      mechanism: "More exposure for a proven profit driver lifts profit per slot.", expectedBenefitType: "gross profit per display position",
      confidence: "medium",
      evidence: [ev("Gross-profit share", pct(p.profitSharePct), "read/profit", f.period, "/health")],
      screenLink: "/stock",
      missingInformation: knowsFacings ? [] : ["current facings and display zone for this product"],
      testDesign: knowsFacings ? "Add one facing; compare gross profit per display position vs baseline for two cheque cycles." : null,
      baselineMetrics: ["current gross profit per position (needs facings)"] ,
      successCriteria: ["Profit per display position rises without hurting a neighbour."], failureCriteria: ["No lift, or a strong neighbour drops."],
      stopCondition: "If a strong neighbour's sales fall, revert the facing.",
    });
  },
};

const weakExcessFacings: KnowledgePlaybook = {
  id: "weak-product-excess-facings", domain: "shelf",
  title: "Weak product occupying too much space",
  principle: "Reclaim shelf from low-profit products and give it to profit drivers.",
  conditions: "A low-profit-share product has 3+ facings.",
  requiredEvidence: ["gross-profit share", "facings"],
  contraindications: ["traffic/impulse product that pulls shoppers in"],
  mechanism: "Reallocating space from weak to strong lifts total profit per shelf.",
  actionTypes: ["reduce_facings", "relocate"],
  expectedBenefitType: "profit per shelf", risks: ["losing a traffic anchor"],
  testDesign: "Remove one facing; give it to a top profit driver for two cheque cycles.",
  minTestDurationDays: 28, successMetrics: ["total profit per shelf up"], failureMetrics: ["traffic falls"],
  confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p) => p.facings != null && p.facings >= 3 && (p.profitSharePct ?? 0) <= 4,
  build: (p, f) => draft({
    title: `Reduce ${p.name}'s facings and reallocate the space`, domain: "shelf", type: "reduce_facings", product: p,
    observedFacts: [`${p.name} occupies ${p.facings} facings but contributes only ${pct(p.profitSharePct)} of gross profit.`],
    principles: ["Space is finite; it should earn its keep in gross profit."],
    reasoning: ["Excess facings on a weak product starve your profit drivers of exposure."],
    truthLevel: "experiment_hypothesis",
    proposedAction: `Take one facing from ${p.name} and give it to a top profit driver; test for two cheque cycles.`,
    implementationSteps: ["Remove one facing from this product.", "Assign it to your highest profit-per-slot product.", "Compare total shelf profit."],
    timing: "next reset", durationDays: 28, effort: "medium",
    mechanism: "Shifts exposure toward higher profit per position.", expectedBenefitType: "profit per shelf",
    confidence: "medium",
    contraindications: [p.impulseType === "impulse" ? "This is an impulse/traffic product — reducing it may cut footfall." : ""].filter(Boolean),
    evidence: [ev("Facings", `${p.facings}`, "products", f.period, "/stock"), ev("Gross-profit share", pct(p.profitSharePct), "read/profit", f.period, "/health")],
    screenLink: "/stock",
    testDesign: "Remove one facing, reassign to a top driver; compare total shelf gross profit over two cheque cycles.",
    successCriteria: ["Total shelf profit rises."], failureCriteria: ["Footfall/traffic visibly drops."],
    stopCondition: "If traffic falls, restore the facing.",
  }),
};

const premiumWeakPresentation: KnowledgePlaybook = {
  id: "premium-weak-presentation", domain: "merchandising",
  title: "Premium product with weak presentation",
  principle: "Premium products need premium presentation to justify their price.",
  conditions: "A premium-tier product sits in a low-visibility zone or level (or presentation unknown).",
  requiredEvidence: ["tier = premium", "display zone / shelf level (to be exact)"],
  contraindications: ["already in a premium block"],
  mechanism: "Better presentation raises perceived value and conversion of premium lines.",
  actionTypes: ["premium_display_block", "change_shelf_level", "separate_premium"],
  expectedBenefitType: "premium conversion", risks: ["no lift if price is the real barrier"],
  testDesign: "Create a small premium block at eye level for two cheque cycles.",
  minTestDurationDays: 28, successMetrics: ["premium units/revenue up"], failureMetrics: ["no change"],
  confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p) => p.tier === "premium",
  build: (p, f) => {
    const knowsZone = p.displayZone != null || p.shelfLevel != null;
    return draft({
      title: `Improve ${p.name}'s premium presentation`, domain: "merchandising", type: "premium_display_block", product: p,
      observedFacts: [
        `${p.name} is a premium-tier product.`,
        knowsZone ? `Currently at ${[p.displayZone, p.shelfLevel].filter(Boolean).join(", ")}.` : "Its display zone/level isn't recorded yet.",
      ],
      principles: ["Premium presentation supports premium pricing."],
      reasoning: ["Premium products under-convert when merchandised like commodities.", knowsZone ? "" : "Without layout data, record the zone before an exact move."],
      truthLevel: "experiment_hypothesis",
      proposedAction: knowsZone ? `Group ${p.name} into a small premium block at eye level and test for two cheque cycles.` : `Record ${p.name}'s display zone/level, then create a premium block.`,
      implementationSteps: knowsZone ? ["Create a small premium block at eye level.", "Give it clean, uncluttered facing.", "Hold two cheque cycles and compare premium sales."] : ["Record the product's current zone and shelf level.", "Then design the premium block."],
      timing: "next reset", durationDays: 28, effort: "medium",
      mechanism: "Raises perceived value and premium conversion.", expectedBenefitType: "premium conversion",
      confidence: "medium",
      evidence: [ev("Tier", "premium", "products", f.period, "/stock")],
      screenLink: "/stock",
      missingInformation: knowsZone ? [] : ["display zone and shelf level for this product"],
      testDesign: knowsZone ? "Eye-level premium block; compare premium units/revenue over two cheque cycles." : null,
      successCriteria: ["Premium units or revenue rise."], failureCriteria: ["No change — price may be the barrier, not presentation."],
      stopCondition: "No lift after two cycles — revert and reconsider price/pack.",
    });
  },
};

const candyImpulsePlacement: KnowledgePlaybook = {
  id: "candy-impulse-placement", domain: "merchandising",
  title: "Impulse product away from the impulse zone",
  principle: "Impulse products belong at the counter/entrance where decisions are made.",
  conditions: "An impulse product sells well but isn't in a counter/entrance zone.",
  requiredEvidence: ["impulse classification OR candy category", "display zone (to be exact)"],
  contraindications: ["already at the counter"],
  mechanism: "Placing impulse items at the decision point lifts attachment and basket size.",
  actionTypes: ["impulse_display", "relocate"],
  expectedBenefitType: "impulse attachment / basket size", risks: ["clutter at the counter"],
  testDesign: "Move to the counter for two weeks; watch attachment.",
  minTestDurationDays: 14, successMetrics: ["units up", "basket size up"], failureMetrics: ["no change"],
  confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p) => (p.impulseType === "impulse" || (p.category ?? "").toLowerCase().includes("candy") || (p.name.toLowerCase().includes("candy"))) && (p.velocityPerDay ?? 0) > 0,
  build: (p, f) => {
    const atCounter = p.displayZone === "counter" || p.displayZone === "entrance";
    if (atCounter) return null;
    return draft({
      title: `Place ${p.name} at the counter as an impulse buy`, domain: "merchandising", type: "impulse_display", product: p,
      observedFacts: [`${p.name} is an impulse-type product that's already selling${p.displayZone ? `, currently in the ${p.displayZone} zone` : " (its zone isn't recorded)"}.`],
      principles: ["Impulse items convert best at the decision point — counter or entrance."],
      reasoning: ["Moving a proven impulse seller to the counter captures add-on purchases."],
      truthLevel: "experiment_hypothesis",
      proposedAction: `Test ${p.name} at the counter for two weeks and watch attachment.`,
      implementationSteps: ["Place a small facing at the counter.", "Keep the main facing in place.", "Compare units and basket size for two weeks."],
      timing: "this week", durationDays: 14, effort: "low",
      mechanism: "Decision-point placement lifts impulse attachment.", expectedBenefitType: "impulse attachment / basket size",
      confidence: "medium",
      evidence: [ev("Velocity", p.velocityPerDay != null ? `${Math.round(p.velocityPerDay * 10) / 10}/day` : "selling", "read/products", f.period, "/sales")],
      screenLink: "/stock",
      missingInformation: p.displayZone == null ? ["current display zone for this product"] : [],
      testDesign: "Counter placement for two weeks; compare units and basket size vs baseline.",
      successCriteria: ["Units and/or basket size rise."], failureCriteria: ["No change; counter becomes cluttered."],
      stopCondition: "No lift after two weeks — return to the aisle.",
    });
  },
};

/* ═══ PACKAGING ═══════════════════════════════════════════════════════════ */

const growingMarginBelowFloor: KnowledgePlaybook = {
  id: "growing-margin-below-floor", domain: "packaging",
  title: "Growing product, margin below the floor",
  principle: "Don't kill demand to fix margin — change the format, not just the price.",
  conditions: "Product revenue is growing but margin sits below the owner's floor.",
  requiredEvidence: ["revenue growth", "margin", "margin floor"],
  contraindications: ["packaging cost unknown (mini-bag economics can't be proven)"],
  mechanism: "A smaller entry format can lift impulse conversion without discounting the kilogram price.",
  actionTypes: ["mini_bag_test", "smaller_entry_size"],
  expectedBenefitType: "impulse conversion at protected unit margin", risks: ["packaging cost erodes the gain"],
  testDesign: "Test a mini-bag format beside a traffic product for two cheque cycles; include packaging cost.",
  minTestDurationDays: 28, successMetrics: ["gross profit per display position up"], failureMetrics: ["weighted sales fall", "packaging cost eats the margin"],
  confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p, f) => p.growthPct != null && p.growthPct > 5 && p.marginPct != null && p.marginPct < floorOf(f) && p.hasCost,
  build: (p, f) => draft({
    title: `Test a mini-bag for ${p.name} instead of cutting price`, domain: "packaging", type: "mini_bag_test", product: p,
    observedFacts: [
      `${p.name} is growing (${pct(p.growthPct)} vs last period) but its margin is ${pct(p.marginPct)}, below your ${floorOf(f)}% floor.`,
      p.packagingCost == null ? "Packaging cost isn't recorded — needed to prove the format is profitable." : `Packaging cost on file: ${egp(p.packagingCost)}.`,
    ],
    principles: ["When a product drives demand but margin lags, change format before price."],
    reasoning: [
      "Growing demand means the product is working — removing it or discounting the kilo would waste that.",
      "A smaller entry price can lift impulse conversion while protecting the per-kilogram margin.",
    ],
    truthLevel: "experiment_hypothesis",
    proposedAction: `Do not remove ${p.name}. Test a small mini-bag format beside a strong traffic product for two cheque cycles, packaging cost included.`,
    implementationSteps: ["Cost the mini-bag (product + packaging + labour).", "Price the entry point below the loose kilo psychology.", "Place beside a traffic product.", "Keep the change only if gross profit per display position improves without cutting weighted sales."],
    timing: "next reset", durationDays: 28, effort: "medium",
    mechanism: "Lower entry price improves impulse conversion without discounting the kilogram price.",
    expectedBenefitType: "impulse conversion at protected unit margin",
    confidence: "medium",
    contraindications: [p.packagingCost == null ? "Mini-bag profitability can't be proven until packaging cost is known." : ""].filter(Boolean),
    assumptions: ["Smaller entry price improves conversion — to be validated by the test."],
    missingInformation: [
      (p.packagingCost == null && !f.offeredPackaging.some((x) => x.type === "mini_bag" && x.hasCost)) ? "confirm you offer a mini-bag format and its packaging cost (Owner Interview → Packaging)" : "",
      p.displayZone == null ? "current display position" : "",
    ].filter(Boolean),
    evidence: [ev("Revenue growth", pct(p.growthPct), "read/products", `${f.comparePeriod}→${f.period}`, "/sales"), ev("Margin", pct(p.marginPct), "read/profit", f.period, "/health")],
    screenLink: "/stock",
    testDesign: "Mini-bag beside a traffic product for two cheque cycles; primary metric gross profit per display position; include packaging cost.",
    baselineMetrics: [`weighted-format weekly units`, `gross profit per position`],
    successCriteria: ["Gross profit per display position improves and weighted-product sales don't fall."],
    failureCriteria: ["Weighted sales drop, or packaging cost erases the margin gain."],
    stopCondition: "If weighted sales fall or the format loses money after packaging cost, stop.",
  }),
};

const grabAndGoOpportunity: KnowledgePlaybook = {
  id: "grab-and-go-opportunity", domain: "packaging",
  title: "Grab-and-go format opportunity",
  principle: "Fast movers with an on-the-go occasion suit a pre-packed grab-and-go size.",
  conditions: "A fast-selling standard/value product is sold loose and has an on-the-go occasion.",
  requiredEvidence: ["velocity", "packaging format = weighted", "packaging cost"],
  contraindications: ["packaging cost unknown", "no on-the-go occasion"],
  mechanism: "A ready-to-carry pack captures convenience-driven and dayparted demand.",
  actionTypes: ["grab_and_go", "smaller_entry_size"],
  expectedBenefitType: "convenience conversion", risks: ["packaging cost", "waste on shelf life"],
  testDesign: "Introduce a grab-and-go size for two cheque cycles beside the counter.",
  minTestDurationDays: 28, successMetrics: ["incremental units", "no cannibalising weighted"], failureMetrics: ["waste", "no uptake"],
  confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p) => (p.velocityPerDay ?? 0) >= 1 && p.packagingFormat === "weighted" && (p.tier === "value" || p.tier === "standard" || p.tier == null),
  build: (p, f) => draft({
    title: `Test a grab-and-go size for ${p.name}`, domain: "packaging", type: "grab_and_go", product: p,
    observedFacts: [`${p.name} sells at ${p.velocityPerDay != null ? Math.round(p.velocityPerDay * 10) / 10 + "/day" : "a steady pace"} and is currently loose/weighted.`],
    principles: ["Convenience formats capture on-the-go demand a loose bin can't."],
    reasoning: ["A steady mover in a weighted format may leave convenience demand on the table."],
    truthLevel: "experiment_hypothesis",
    proposedAction: `Introduce a small grab-and-go pack of ${p.name} beside the counter for two cheque cycles.`,
    implementationSteps: ["Cost the pack including packaging.", "Place a small facing at the counter.", "Watch incremental units vs weighted sales."],
    timing: "next reset", durationDays: 28, effort: "medium",
    mechanism: "Ready-to-carry format captures convenience-driven purchases.", expectedBenefitType: "convenience conversion",
    confidence: "medium",
    missingInformation: [p.packagingCost == null ? "packaging cost per grab-and-go pack" : ""].filter(Boolean),
    evidence: [ev("Velocity", p.velocityPerDay != null ? `${Math.round(p.velocityPerDay * 10) / 10}/day` : "steady", "read/products", f.period, "/sales")],
    screenLink: "/stock",
    testDesign: "Grab-and-go pack at the counter for two cheque cycles; watch incremental units and waste.",
    successCriteria: ["Incremental units without cannibalising weighted sales."], failureCriteria: ["Waste from shelf life, or no uptake."],
    stopCondition: "Waste climbs or no uptake after two cycles — discontinue the pack.",
  }),
};

/* ═══ PRICING ═════════════════════════════════════════════════════════════ */

const highVolumeLowMarginTraffic: KnowledgePlaybook = {
  id: "high-volume-low-margin-traffic", domain: "pricing",
  title: "High-volume, low-margin traffic driver",
  principle: "Protect the products that pull shoppers in; fix profit through mix, not their price.",
  conditions: "A high-revenue-share product has a below-floor margin and healthy volume.",
  requiredEvidence: ["revenue share", "margin", "margin floor"],
  contraindications: ["margin gap caused by cost rise, not positioning"],
  mechanism: "Raising the price of a traffic driver can cut footfall; improve mix instead.",
  actionTypes: ["protect_traffic", "avoid_price_change_mix"],
  expectedBenefitType: "protected traffic + mix-led profit", risks: ["margin stays thin if mix isn't addressed"],
  testDesign: "Hold price; pair with a higher-margin attach; watch blended margin.",
  minTestDurationDays: 28, successMetrics: ["blended margin up", "traffic held"], failureMetrics: ["traffic falls"],
  confidenceCeiling: "high", basis: "retail_math", version: 1,
  match: (p, f) => p.revenueSharePct >= 15 && p.marginPct != null && p.marginPct < floorOf(f) && (p.velocityPerDay ?? 0) > 0,
  build: (p, f) => draft({
    title: `Protect ${p.name}'s price — fix profit through mix`, domain: "pricing", type: "avoid_price_change_mix", product: p,
    observedFacts: [
      `${p.name} is ${pct(p.revenueSharePct)} of revenue at a ${pct(p.marginPct)} margin (below your ${floorOf(f)}% floor).`,
      p.ownerTrafficDriver ? "You've confirmed it's a traffic driver — customers come specifically for it." : "Its volume is healthy — it's pulling shoppers in.",
    ],
    principles: ["Don't raise the price of a traffic driver; recover margin through mix and attachment."],
    reasoning: [
      p.ownerTrafficDriver ? "You've confirmed this is a traffic driver." : "A big revenue share at healthy volume signals a traffic product.",
      "Raising its price risks footfall; the profit issue is mix, not this product's price.",
    ],
    truthLevel: p.ownerTrafficDriver ? "measured_conclusion" : "strong_inference",
    proposedAction: `Hold ${p.name}'s price. Pair it with a higher-margin attach and watch blended margin.`,
    implementationSteps: ["Keep the price steady.", "Offer a higher-margin add-on beside it.", "Track blended margin and traffic."],
    timing: "this month", durationDays: 28, effort: "low",
    mechanism: "Preserves footfall while lifting profit through attachment.", expectedBenefitType: "protected traffic + mix-led profit",
    confidence: "high",
    evidence: [ev("Revenue share", pct(p.revenueSharePct), "read/products", f.period, "/sales"), ev("Margin", pct(p.marginPct), "read/profit", f.period, "/health")],
    screenLink: "/health",
    successCriteria: ["Blended margin rises; traffic holds."], failureCriteria: ["Traffic falls if the price is touched."],
    stopCondition: "If footfall dips, revert any change immediately.",
  }),
};

const marginRecoveryReview: KnowledgePlaybook = {
  id: "margin-recovery-review", domain: "pricing",
  title: "Margin below floor on a non-traffic product",
  principle: "Test a price before you commit to one — a smaller pack often tests it more safely.",
  conditions: "A modest-share product has margin below the floor and stable demand.",
  requiredEvidence: ["margin", "revenue share", "cost recorded"],
  contraindications: ["traffic driver", "cost data missing"],
  mechanism: "A test price (or a smaller pack) recovers margin without a permanent, risky commitment.",
  actionTypes: ["review_price", "test_smaller_pack", "test_price_increase"],
  expectedBenefitType: "margin recovery", risks: ["volume loss if demand is price-sensitive"],
  testDesign: "Test the new price (or a smaller pack) for two cheque cycles; watch units.",
  minTestDurationDays: 28, successMetrics: ["margin up, units hold"], failureMetrics: ["units fall sharply"],
  confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p, f) => p.marginPct != null && p.marginPct < floorOf(f) && p.revenueSharePct < 15 && p.revenueSharePct >= 1 && p.hasCost && (p.growthPct == null || p.growthPct >= -5),
  build: (p, f) => draft({
    title: `Test a price on ${p.name} rather than commit to one`, domain: "pricing", type: "test_smaller_pack", product: p,
    observedFacts: [`${p.name} runs a ${pct(p.marginPct)} margin, below your ${floorOf(f)}% floor, on ${pct(p.revenueSharePct)} of revenue.`],
    principles: ["Test a price before permanently changing it; a smaller pack tests it more safely."],
    reasoning: ["Below-floor margin with stable demand is a candidate for a controlled price test."],
    truthLevel: "experiment_hypothesis",
    proposedAction: `Test a smaller pack (or a modest price step) on ${p.name} for two cheque cycles before any permanent change.`,
    implementationSteps: ["Pick a smaller pack or a modest price step.", "Run it two cheque cycles.", "Keep it only if margin improves and units hold."],
    timing: "next reset", durationDays: 28, effort: "low",
    mechanism: "Recovers margin without a permanent, risky commitment.", expectedBenefitType: "margin recovery",
    confidence: "medium",
    evidence: [ev("Margin", pct(p.marginPct), "read/profit", f.period, "/health")],
    screenLink: "/health",
    testDesign: "Price/pack test for two cheque cycles; primary metric margin, guardrail units.",
    successCriteria: ["Margin improves and units hold."], failureCriteria: ["Units fall sharply."],
    stopCondition: "If units drop sharply, revert to the current price.",
  }),
};

const missingCostBlocksProfit: KnowledgePlaybook = {
  id: "missing-cost-blocks-profit", domain: "margin",
  title: "Sold product with no recorded cost",
  principle: "You can't manage margin you can't see — record cost to unlock profit.",
  conditions: "A product has sales but no confident cost.",
  requiredEvidence: ["revenue > 0", "cost missing"],
  contraindications: [],
  mechanism: "Recording cost unlocks gross profit, margin and every downstream recommendation.",
  actionTypes: ["collect_evidence"],
  expectedBenefitType: "unlocked profit visibility", risks: [],
  testDesign: "Record a purchase or reference cost; profit recomputes.",
  minTestDurationDays: 1, successMetrics: ["cost recorded", "margin visible"], failureMetrics: [],
  confidenceCeiling: "high", basis: "retail_math", version: 1,
  match: (p) => !p.hasCost && p.revenue > 0,
  build: (p, f) => draft({
    title: `Record a cost for ${p.name} to unlock its profit`, domain: "margin", type: "collect_evidence", product: p,
    observedFacts: [`${p.name} has ${egp(p.revenue)} of sales this period but no confident cost, so its gross profit is withheld.`],
    principles: ["Margin management starts with a recorded cost."],
    reasoning: ["Without cost, profit, margin and every product recommendation for it are blocked."],
    truthLevel: "measured_conclusion",
    proposedAction: `Record a purchase (or reference cost) for ${p.name}.`,
    implementationSteps: ["Open the product in Goods.", "Enter a purchase or reference unit cost.", "Profit recomputes automatically."],
    timing: "this week", durationDays: 1, effort: "low",
    mechanism: "Unlocks gross profit and every downstream recommendation.", expectedBenefitType: "unlocked profit visibility",
    confidence: "high",
    evidence: [ev("Revenue (no cost)", egp(p.revenue), "read/products", f.period, "/sales")],
    screenLink: "/costs",
    successCriteria: ["Cost recorded; margin becomes visible."], failureCriteria: [],
    stopCondition: null,
  }),
};

/* ═══ PROMOTION ═══════════════════════════════════════════════════════════ */

const avoidDiscountStrong: KnowledgePlaybook = {
  id: "avoid-discount-strong", domain: "promotion",
  title: "Don't discount a product already selling strongly",
  principle: "Discounting strong demand gives away margin you'd have earned anyway.",
  conditions: "A product is growing with high volume and healthy margin.",
  requiredEvidence: ["revenue growth", "volume", "margin"],
  contraindications: ["clearing dated stock"],
  mechanism: "Using a weak product as the add-on grows basket without discounting the strong one.",
  actionTypes: ["avoid_discount_strong", "weak_as_addon"],
  expectedBenefitType: "protected margin + basket growth", risks: ["none material"],
  testDesign: "Pair the strong product with a weak add-on rather than discounting it.",
  minTestDurationDays: 14, successMetrics: ["basket up, margin held"], failureMetrics: ["no basket lift"],
  confidenceCeiling: "high", basis: "retail_math", version: 1,
  match: (p, f) => p.growthPct != null && p.growthPct > 8 && p.revenueSharePct >= 10 && p.marginPct != null && p.marginPct >= floorOf(f),
  build: (p, f) => draft({
    title: `Don't discount ${p.name} — it's already strong`, domain: "promotion", type: "avoid_discount_strong", product: p,
    observedFacts: [`${p.name} is growing ${pct(p.growthPct)} with a healthy ${pct(p.marginPct)} margin on ${pct(p.revenueSharePct)} of revenue.`],
    principles: ["Never discount demand you already have — use it to pull weaker lines."],
    reasoning: ["Discounting a growing, healthy-margin product simply gives away earned margin."],
    truthLevel: "measured_conclusion",
    proposedAction: `Keep ${p.name} at full price; use a weak product as a small add-on beside it to grow basket.`,
    implementationSteps: ["Hold the price.", "Attach a slow-moving product as a small add-on.", "Track basket size."],
    timing: "this week", durationDays: 14, effort: "low",
    mechanism: "Grows basket without sacrificing the strong product's margin.", expectedBenefitType: "protected margin + basket growth",
    confidence: "high",
    evidence: [ev("Revenue growth", pct(p.growthPct), "read/products", `${f.comparePeriod}→${f.period}`, "/sales"), ev("Margin", pct(p.marginPct), "read/profit", f.period, "/health")],
    screenLink: "/health",
    successCriteria: ["Basket size rises; margin held."], failureCriteria: ["No basket lift."],
    stopCondition: null,
  }),
};

/* ═══ PORTFOLIO (global / cross-product) ═════════════════════════════════ */

const portfolioConcentration: KnowledgePlaybook = {
  id: "portfolio-concentration", domain: "risk",
  title: "Revenue concentration risk",
  principle: "Over-reliance on one product is a single point of failure.",
  conditions: "One product exceeds ~40% of revenue.",
  requiredEvidence: ["per-product revenue share"],
  contraindications: ["deliberate single-hero strategy"],
  mechanism: "Diversifying demand reduces exposure to one product's supply or price shock.",
  actionTypes: ["reduce_exposure", "expand"],
  expectedBenefitType: "revenue resilience", risks: ["spreading focus too thin"],
  testDesign: "Grow the #2/#3 profit drivers; watch concentration fall.",
  minTestDurationDays: 60, successMetrics: ["top-product share falls"], failureMetrics: ["total revenue falls"],
  confidenceCeiling: "high", basis: "retail_math", version: 1,
  global: (f) => {
    const top = [...f.products].sort((a, b) => b.revenueSharePct - a.revenueSharePct)[0];
    if (!top || top.revenueSharePct < 40) return [];
    return [draft({
      title: `Revenue leans heavily on ${top.name}`, domain: "risk", type: "reduce_exposure",
      affectedProducts: [top.name], affectedProductIds: top.id ? [top.id] : [], affectedCategory: top.category,
      observedFacts: [`${top.name} is ${pct(top.revenueSharePct)} of period revenue — a concentration risk.`],
      principles: ["Diversify demand so no single product's shock can sink the month."],
      reasoning: ["A single product above 40% of revenue is a single point of failure on supply or price."],
      truthLevel: "measured_conclusion",
      proposedAction: `Grow your #2 and #3 profit drivers to reduce reliance on ${top.name}.`,
      implementationSteps: ["Identify the next two profit drivers.", "Give them more exposure/attachment.", "Watch concentration fall without losing total revenue."],
      timing: "this quarter", durationDays: 60, effort: "medium",
      mechanism: "Broader demand base reduces single-product exposure.", expectedBenefitType: "revenue resilience",
      confidence: "high",
      evidence: [ev("Top-product revenue share", pct(top.revenueSharePct), "read/products", f.period, "/sales")],
      screenLink: "/health",
      successCriteria: ["Top-product share falls while total revenue holds."], failureCriteria: ["Total revenue drops."],
      stopCondition: "If total revenue falls, refocus on the hero product.",
    })];
  },
};

/* ═══ SEASONALITY ════════════════════════════════════════════════════════ */

const eidPremiumPackaging: KnowledgePlaybook = {
  id: "eid-premium-packaging", domain: "seasonality",
  title: "Eid premium gifting packaging",
  principle: "Gifting seasons reward premium presentation and gift formats.",
  conditions: "Eid season is active and the product is premium-tier.",
  requiredEvidence: ["season = eid (confirmed)", "tier = premium"],
  contraindications: ["not a giftable product"],
  mechanism: "Gift formats capture occasion-driven premium demand at higher basket values.",
  actionTypes: ["gift_format", "premium_pouch"],
  expectedBenefitType: "occasion-driven premium sales", risks: ["packaging cost", "leftover seasonal stock"],
  testDesign: "Offer a gift format for the Eid window only; watch premium basket value.",
  minTestDurationDays: 14, successMetrics: ["premium basket value up"], failureMetrics: ["leftover seasonal packaging"],
  confidenceCeiling: "medium", basis: "owner_confirmed", version: 1,
  match: (p, f) => f.season === "eid" && p.tier === "premium",
  build: (p, f) => draft({
    title: `Offer an Eid gift format for ${p.name}`, domain: "seasonality", type: "gift_format", product: p,
    observedFacts: [`Eid is active and ${p.name} is a premium-tier product suited to gifting.`],
    principles: ["Gifting seasons reward premium presentation and gift-ready formats."],
    reasoning: ["Premium products convert best during gifting occasions in gift formats."],
    truthLevel: "experiment_hypothesis",
    proposedAction: `Introduce a limited Eid gift format for ${p.name} for the season window only.`,
    implementationSteps: ["Design a simple gift pack.", "Cost it including packaging.", "Offer only for the Eid window."],
    timing: "ahead of Eid", durationDays: 14, effort: "medium",
    mechanism: "Occasion-driven premium demand at higher basket values.", expectedBenefitType: "occasion-driven premium sales",
    confidence: "medium",
    assumptions: ["Eid gifting demand exists for this product — owner-confirmed seasonal context."],
    missingInformation: [p.packagingCost == null ? "gift-packaging cost" : ""].filter(Boolean),
    evidence: [ev("Season", "Eid", "calendar/context", f.period, "/health"), ev("Tier", "premium", "products", f.period, "/stock")],
    screenLink: "/stock",
    testDesign: "Eid-window gift format; primary metric premium basket value; avoid over-ordering seasonal packaging.",
    successCriteria: ["Premium basket value rises during the window."], failureCriteria: ["Leftover seasonal packaging."],
    stopCondition: "Order conservatively; stop if uptake is weak mid-window.",
  }),
};

/* ═══ CROSS-CATEGORY ADJACENCY / PREMIUM ENTRY (executive playbooks) ═════ */

const profitBesideTraffic: KnowledgePlaybook = {
  id: "profit-beside-traffic", domain: "merchandising",
  title: "Place a profit driver beside the traffic magnet",
  principle: "Attach your highest-profit product to the product that pulls the most shoppers.",
  rationale: "The traffic product creates footfall it doesn't monetise well; putting a high-profit product in its shadow converts that attention into margin without extra traffic cost.",
  whenApplicable: "The top traffic product (revenue/volume) and the top gross-profit product are different items.",
  whenNotApplicable: "The two are the same product, or shelf adjacency is physically impossible.",
  conditions: "A clear traffic driver and a distinct top profit driver both exist.",
  requiredEvidence: ["per-product revenue share", "per-product gross-profit share"],
  contraindications: ["the profit product is already adjacent", "premium product would look cheap beside the traffic product"],
  mechanism: "Impulse attachment: shoppers drawn by the traffic product see the profit product at the decision point.",
  actionTypes: ["improve_adjacency", "relocate"],
  expectedBenefitType: "gross profit per facing + basket attachment",
  risks: ["no attachment lift", "premium image dilution"],
  assumptions: ["shoppers of the traffic product are receptive to the profit product"],
  kpis: ["gross profit per facing", "basket attachment rate"],
  testDesign: "Trial the adjacency for two cheque cycles; measure gross profit per facing and attachment before making it permanent.",
  minTestDurationDays: 28, reviewCadenceDays: 28,
  successMetrics: ["gross profit per facing up", "attachment rate up"], failureMetrics: ["no attachment lift", "traffic product sales dip"],
  relatedPrinciples: ["profit-driver-low-space", "high-volume-low-margin-traffic"],
  confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  global: (f) => {
    const byRev = [...f.products].sort((a, b) => b.revenueSharePct - a.revenueSharePct);
    const byProfit = [...f.products].filter((p) => p.profitSharePct != null).sort((a, b) => (b.profitSharePct ?? 0) - (a.profitSharePct ?? 0));
    const traffic = byRev[0];
    const profit = byProfit[0];
    if (!traffic || !profit || traffic.name === profit.name || (profit.profitSharePct ?? 0) < 12 || traffic.revenueSharePct < 12) return [];
    return [draft({
      title: `Trial ${profit.name} immediately beside ${traffic.name}`, domain: "merchandising", type: "improve_adjacency",
      affectedProducts: [profit.name, traffic.name], affectedProductIds: [], affectedCategory: profit.category,
      observedFacts: [
        `${traffic.name} is your traffic magnet (${pct(traffic.revenueSharePct)} of revenue) while ${profit.name} is your top profit generator (${pct(profit.profitSharePct)} of gross profit).`,
      ],
      principles: ["Attach the highest-profit product to the biggest traffic magnet."],
      reasoning: [
        `${traffic.name} creates footfall; ${profit.name} monetises it best.`,
        "Adjacency converts that attention into margin without buying more traffic.",
      ],
      truthLevel: "experiment_hypothesis",
      proposedAction: `Trial relocating ${profit.name} immediately adjacent to ${traffic.name} for two cheque cycles. Measure gross profit per facing and basket attachment before making it permanent.`,
      implementationSteps: [`Place ${profit.name} directly beside ${traffic.name}.`, "Keep everything else fixed.", "Compare gross profit per facing and attachment vs baseline."],
      timing: "next reset", durationDays: 28, effort: "low",
      mechanism: "Impulse attachment at the traffic product's decision point.", expectedBenefitType: "gross profit per facing + basket attachment",
      confidence: "medium",
      contraindications: [profit.tier === "premium" ? "Keep the premium look — don't let it read as cheap beside a value traffic line." : ""].filter(Boolean),
      missingInformation: [f.products.some((p) => p.facings != null) ? "" : "current facings/zone (to make the move exact)"].filter(Boolean),
      evidence: [
        ev("Traffic product revenue share", pct(traffic.revenueSharePct), "read/products", f.period, "/sales"),
        ev("Profit product gross-profit share", pct(profit.profitSharePct), "read/profit", f.period, "/health"),
      ],
      screenLink: "/stock",
      testDesign: "Adjacency trial for two cheque cycles; primary metric gross profit per facing, secondary basket attachment.",
      baselineMetrics: ["gross profit per facing (both products)", "attachment rate"],
      successCriteria: ["gross profit per facing rises", "attachment rate rises"], failureCriteria: ["no attachment lift", `${traffic.name} sales dip`],
      stopCondition: "If the traffic product's sales dip, revert the move.",
    })];
  },
};

const premiumEntrySize: KnowledgePlaybook = {
  id: "premium-entry-size", domain: "packaging",
  title: "Lower the premium entry barrier without cutting the kilo price",
  principle: "For a strong premium line, a smaller entry-size pack widens trial while protecting the per-kilogram price.",
  rationale: "Discounting a premium product erodes both margin and perceived value; a smaller pack lowers the psychological entry price instead, preserving the price architecture.",
  whenApplicable: "A premium-tier product with a healthy margin and a high price per kilo.",
  whenNotApplicable: "Margin is below floor (fix margin first), or packaging cost is unknown so pack economics can't be proven.",
  conditions: "Premium tier, margin at/above floor, a selling price is recorded.",
  requiredEvidence: ["tier = premium", "margin", "selling price", "packaging cost (to prove economics)"],
  contraindications: ["packaging cost unknown", "product already offered in a small pack"],
  mechanism: "A lower absolute entry price recruits trial buyers while the per-kilogram price (and premium signal) is preserved.",
  actionTypes: ["test_smaller_pack", "smaller_entry_size", "premium_pouch"],
  expectedBenefitType: "premium trial at protected per-kg margin",
  risks: ["packaging cost erodes the gain", "cannibalises the weighted format"],
  assumptions: ["a smaller entry price recruits new trial buyers"],
  kpis: ["gross profit per display position", "new-buyer trial", "per-kg price held"],
  testDesign: "Introduce a smaller entry-size pack for two cheque cycles; include packaging cost; compare gross profit per display position; keep per-kg price unchanged.",
  minTestDurationDays: 28, reviewCadenceDays: 28,
  successMetrics: ["gross profit per display position up", "per-kg price preserved"], failureMetrics: ["weighted sales fall", "packaging cost eats the margin"],
  relatedPrinciples: ["growing-margin-below-floor", "premium-weak-presentation"],
  confidenceCeiling: "medium", basis: "retail_heuristic", version: 1,
  match: (p, f) => p.tier === "premium" && p.marginPct != null && p.marginPct >= floorOf(f) && p.sellingPrice != null,
  build: (p, f) => draft({
    title: `Test a smaller entry-size pack for ${p.name}`, domain: "packaging", type: "test_smaller_pack", product: p,
    observedFacts: [
      `${p.name} is premium-tier with a healthy ${pct(p.marginPct)} margin${p.sellingPrice != null ? ` at ${egp(p.sellingPrice)}/unit` : ""}.`,
      p.packagingCost == null ? "Packaging cost isn't recorded — needed to prove the pack is profitable." : `Packaging cost on file: ${egp(p.packagingCost)}.`,
    ],
    principles: ["Widen premium trial with a smaller pack; never discount the kilo."],
    reasoning: [
      "Discounting a premium line erodes margin and perceived value.",
      "A smaller entry-size pack lowers the absolute entry price while the per-kilogram price and premium signal are preserved.",
    ],
    truthLevel: "experiment_hypothesis",
    proposedAction: `Instead of discounting ${p.name}, introduce a smaller entry-size pack. Preserve the premium per-kilogram price and lower the psychological entry barrier. Include packaging cost and compare gross profit per display position.`,
    implementationSteps: ["Cost the smaller pack (product + packaging).", "Keep the per-kg price unchanged.", "Run two cheque cycles.", "Keep it only if gross profit per display position improves without cutting weighted sales."],
    timing: "next reset", durationDays: 28, effort: "medium",
    mechanism: "Lower entry price recruits trial while the per-kg price protects margin and premium signal.",
    expectedBenefitType: "premium trial at protected per-kg margin",
    confidence: "medium",
    contraindications: [p.packagingCost == null ? "Pack economics can't be proven until packaging cost is recorded." : ""].filter(Boolean),
    assumptions: ["A smaller entry price recruits new trial buyers."],
    missingInformation: [p.packagingCost == null ? "packaging cost per small pack" : "", p.displayZone == null ? "current display position" : ""].filter(Boolean),
    evidence: [ev("Tier", "premium", "products", f.period, "/stock"), ev("Margin", pct(p.marginPct), "read/profit", f.period, "/health")],
    screenLink: "/stock",
    testDesign: "Smaller entry-size pack for two cheque cycles; per-kg price held; primary metric gross profit per display position; include packaging cost.",
    baselineMetrics: ["gross profit per display position", "weighted-format weekly units"],
    successCriteria: ["gross profit per display position improves", "weighted sales don't fall"],
    failureCriteria: ["weighted sales fall", "packaging cost erases the margin gain"],
    stopCondition: "If weighted sales fall or the pack loses money after packaging cost, stop.",
  }),
};

/* ═══ SUPPLIER / PURCHASE TIMING (context-driven) ═══════════════════════ */

const supplierQuantityBreak: KnowledgePlaybook = {
  id: "supplier-quantity-break", domain: "purchase",
  title: "Quantity-break tier worth reaching (within cover)",
  principle: "Buy up to a quantity-break tier only when the lower unit cost doesn't push you past your cover target.",
  rationale: "Quantity breaks cut unit cost, but over-buying to reach them converts the saving into trapped cash and waste.",
  whenApplicable: "The product has recorded quantity-break tiers and current cover leaves room to order.",
  whenNotApplicable: "Cover is already above target, or the break quantity would blow past the cover ceiling.",
  conditions: "Quantity-break tiers exist for the product and cover is below the maximum.",
  requiredEvidence: ["quantity-break tiers", "days of cover", "max-cover target"],
  contraindications: ["cover already high", "cash unavailable"],
  mechanism: "A lower unit cost lifts gross margin without holding excess stock.",
  actionTypes: ["meet_qty_break", "avoid_exceed_cover"],
  expectedBenefitType: "unit-cost saving at controlled cover",
  risks: ["over-buying to reach the break", "cash strain"],
  assumptions: ["the next tier's quantity fits inside the cover ceiling"],
  kpis: ["blended unit cost", "days of cover"],
  testDesign: "Order to the next break tier only if projected cover stays within target; compare blended unit cost.",
  minTestDurationDays: 30, reviewCadenceDays: 30,
  successMetrics: ["unit cost falls", "cover stays in range"], failureMetrics: ["cover exceeds target", "waste rises"],
  relatedPrinciples: ["overstock-vs-cover", "stockout-risk-profit-driver"],
  confidenceCeiling: "high", basis: "retail_math", version: 1,
  match: (p, f) => p.quantityBreaks != null && p.quantityBreaks.length > 0 && p.daysCover != null && p.daysCover < coverMax(f) && f.inventoryTracked,
  build: (p, f) => {
    const tiers = p.quantityBreaks!;
    const best = [...tiers].sort((a, b) => a.unitCost - b.unitCost)[0];
    return draft({
      title: `Consider the ${best.minQty}+ quantity break on ${p.name}`, domain: "purchase", type: "meet_qty_break", product: p,
      observedFacts: [
        `${p.name} has a quantity break at ${best.minQty}+ units (unit cost ${egp(best.unitCost)}).`,
        `Current cover is ${Math.round(p.daysCover!)} days vs your ${coverMax(f)}-day target — there's room to buy.`,
      ],
      principles: ["Reach a quantity break only within your cover target."],
      reasoning: ["The lower unit cost lifts margin.", "Cover is below target, so the larger order won't over-invest — provided the break quantity fits."],
      truthLevel: "strong_inference",
      proposedAction: `Order ${p.name} up to the ${best.minQty}+ break tier only if projected cover stays within ${coverMax(f)} days.`,
      implementationSteps: ["Check the break quantity against your cover ceiling.", "If it fits, order to the tier.", "If it would exceed cover, stay below the break."],
      timing: "next order", durationDays: 30, effort: "low",
      mechanism: "Lower unit cost at controlled cover lifts blended margin.", expectedBenefitType: "unit-cost saving at controlled cover",
      confidence: "medium",
      contraindications: [f.cashForPurchases != null && f.cashForPurchases <= 0 ? "Cash is unavailable — time it to the cheque." : ""].filter(Boolean),
      evidence: [ev("Quantity break", `${best.minQty}+ @ ${egp(best.unitCost)}`, "products", f.period, "/purchases"), ev("Cover", `${Math.round(p.daysCover!)}d`, "read/stock", f.period, "/stock")],
      screenLink: "/purchases",
      testDesign: "Order to the tier only if projected cover ≤ target; compare blended unit cost over one cycle.",
      successCriteria: ["blended unit cost falls", "cover stays within target"], failureCriteria: ["cover exceeds target", "waste rises"],
      stopCondition: "If the break quantity would exceed cover, don't reach for it.",
    });
  },
};

const chequeCyclePurchasing: KnowledgePlaybook = {
  id: "cheque-cycle-purchasing", domain: "purchase",
  title: "Time a restock to the cheque cycle",
  principle: "For non-critical restocks, align purchasing with cheque settlement to protect operating liquidity.",
  rationale: "Buying just before a cheque lands strains the drawer; timing the order to just after keeps liquidity intact.",
  whenApplicable: "A product needs restocking soon, it isn't a top profit driver, and the next cheque timing is known.",
  whenNotApplicable: "It's a profit driver at stockout risk (protect availability instead), or cash is confirmed ample.",
  conditions: "Restock needed, not a top profit driver, next-cheque ETA known.",
  requiredEvidence: ["low stock / cover", "next-cheque ETA"],
  contraindications: ["profit driver at stockout risk", "supplier can't wait"],
  mechanism: "Aligning outflow with the cheque inflow preserves the cash reserve.",
  actionTypes: ["buy_after_cheque", "count_first"],
  expectedBenefitType: "protected operating liquidity",
  risks: ["stockout before the cheque"],
  assumptions: ["demand holds until the cheque lands"],
  kpis: ["reserve maintained", "no stockout"],
  testDesign: "Delay the order to just after the next cheque; confirm no stockout in between.",
  minTestDurationDays: 14, reviewCadenceDays: 14,
  successMetrics: ["reserve held", "no stockout"], failureMetrics: ["stockout before cheque"],
  relatedPrinciples: ["stockout-risk-profit-driver", "overstock-vs-cover"],
  confidenceCeiling: "high", basis: "owner_confirmed", version: 1,
  match: (p, f) => (p.isLow || (p.daysCover != null && p.daysCover < 10)) && (p.profitSharePct ?? 0) < 12 && f.inventoryTracked && f.nextChequeEta != null,
  build: (p, f) => draft({
    title: `Time the ${p.name} restock to the next cheque`, domain: "purchase", type: "buy_after_cheque", product: p,
    observedFacts: [
      `${p.name} is ${p.isLow ? "flagged low" : `at ${Math.round(p.daysCover ?? 0)} days cover`} but isn't a top profit driver.`,
      `The next cheque is expected around ${f.nextChequeEta}.`,
    ],
    principles: ["Time non-critical restocks to the cheque cycle to protect liquidity."],
    reasoning: ["Restocking just before a cheque strains the drawer.", "Since this isn't a profit driver at risk, the order can wait for the inflow."],
    truthLevel: "strong_inference",
    proposedAction: `Delay the ${p.name} restock to just after the cheque around ${f.nextChequeEta}, unless it's about to stock out.`,
    implementationSteps: ["Confirm current stock lasts until the cheque.", "Place the order once cash lands.", "If stock won't last, order a minimal bridge quantity."],
    timing: `around ${f.nextChequeEta}`, durationDays: 14, effort: "low",
    mechanism: "Aligns the outflow with the cheque inflow, protecting the reserve.", expectedBenefitType: "protected operating liquidity",
    confidence: "medium",
    evidence: [ev("Cover", p.daysCover != null ? `${Math.round(p.daysCover)}d` : "low", "read/stock", f.period, "/stock"), ev("Next cheque", f.nextChequeEta ?? "—", "read/cheques", f.period, "/cheques")],
    screenLink: "/purchases",
    successCriteria: ["reserve maintained", "no stockout before the cheque"], failureCriteria: ["stockout before the cheque lands"],
    stopCondition: "If stock will run out first, place a minimal bridge order.",
  }),
};

/** THE LIBRARY. */
export const KNOWLEDGE_LIBRARY: KnowledgePlaybook[] = [
  profitBesideTraffic, premiumEntrySize, supplierQuantityBreak, chequeCyclePurchasing,
  highValueSlowMover, deadStock, overstockVsCover, stockoutRiskProfitDriver,
  profitDriverLowSpace, weakExcessFacings, premiumWeakPresentation, candyImpulsePlacement,
  growingMarginBelowFloor, grabAndGoOpportunity,
  highVolumeLowMarginTraffic, marginRecoveryReview, missingCostBlocksProfit,
  avoidDiscountStrong,
  portfolioConcentration,
  eidPremiumPackaging,
];

export function playbookById(id: string): KnowledgePlaybook | undefined {
  return KNOWLEDGE_LIBRARY.find((p) => p.id === id);
}
