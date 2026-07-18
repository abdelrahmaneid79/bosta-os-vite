/** UNIT-ECONOMICS PLAYBOOKS — the ones that need TRUE margin, not gross.
 *
 *  Gross margin flatters this business. Three costs land after it: the mall's
 *  revenue commission, a FLAT packaging cost per pack (box + brand sticker),
 *  and a fixed monthly base. These playbooks reason on the number the owner
 *  actually keeps, which repeatedly inverts the gross-margin ranking:
 *
 *   - a cheap, fast line can lose a third of its margin to packaging, because
 *     the box costs the same whether it holds 120g of pistachios or 220g of
 *     peanuts;
 *   - a premium nut can look healthy at 24% gross and still be one of the
 *     worst earners once commission is taken.
 *
 *  Each fires only when the physical facts needed are actually recorded — with
 *  no pack size we report gross margin and ask for the observation rather than
 *  inventing a fill weight. */
import type { KnowledgePlaybook, RetailBusinessFacts, ProductFact, RecommendationDraft } from "./contract";
import { draft, ev, egp, pct } from "./helpers";
import { trueEconomics, repackSaving, type StoreCostModel } from "./unit-economics";

/** Current Gardenia terms (Era 3: 3% of revenue + flat rent). Rent is fixed and
 *  belongs in break-even, not in per-product margin, so it is not applied here. */
const COMMISSION_PCT = 0.03;

/** Shopper price bands, from the pack prices actually observed on this stand
 *  (roughly 23–146 EGP). A pack is a purchase occasion before it is a cost
 *  calculation: below IMPULSE it is a grab-and-go, above TAKE_HOME it stops
 *  being an everyday snack. These bounds stop the engine proposing a pack that
 *  is cheaper per kg but that nobody would actually carry to the till. */
const IMPULSE_TICKET_MAX = 60;
const TAKE_HOME_TICKET_MAX = 120;

const modelFor = (p: ProductFact): StoreCostModel => ({
  commissionPct: COMMISSION_PCT,
  packagingCostPerPack: p.packagingCost ?? 0,
  fixedMonthly: 0, // not used for per-product margin
});

const econ = (p: ProductFact) =>
  trueEconomics({ name: p.name, pricePerKg: p.sellingPrice, costPerKg: p.avgCost, packSizeG: p.packSizeG }, modelFor(p));

const hasPackFacts = (p: ProductFact) =>
  p.sellingPrice != null && p.sellingPrice > 0 && p.avgCost > 0 && p.packSizeG != null && p.packSizeG > 0 && p.packagingCost != null && p.packagingCost > 0;

/* ═══ 1. The packaging tax — fix it with a bigger pack, never a cheaper box ══ */

const packagingTaxRepack: KnowledgePlaybook = {
  id: "packaging-tax-repack", domain: "packaging",
  title: "Packaging is eating a cheap line — pack bigger",
  principle: "Packaging is charged per PACK, so on a low-ticket item it is a tax on the price, not on the product. The lever is fewer, larger packs — never a cheaper box.",
  conditions: "Packaging costs more than ~6% of the pack's shelf price.",
  requiredEvidence: ["selling price", "cost", "typical pack weight", "packaging cost per pack"],
  contraindications: ["premium line where a small entry pack is the point", "pack size fixed by the format"],
  mechanism: "Doubling the fill roughly halves packaging per kg while selling the same volume, so the saving drops straight to profit with no price change.",
  actionTypes: ["larger_value_size"],
  expectedBenefitType: "packaging cost saved", risks: ["a higher shelf price may slow units on an impulse line"],
  testDesign: "Move one line to the larger fill for two cheque cycles and compare packs used and units sold.",
  minTestDurationDays: 21, successMetrics: ["packs used per kg falls", "units sold holds"], failureMetrics: ["units drop more than 10%"],
  confidenceCeiling: "high", basis: "retail_math", version: 1,
  rationale: "A flat per-pack cost is regressive: it takes a large share of a cheap ticket and a trivial share of an expensive one.",
  whenApplicable: "Low-ticket, high-turn lines sold by weight into a standard box.",
  whenNotApplicable: "Premium lines where a small pack is deliberately the entry price point.",
  kpis: ["packaging as % of revenue", "packs per kg"], reviewCadenceDays: 30,
  match: (p) => {
    if (!hasPackFacts(p)) return false;
    const e = econ(p);
    if ((e.packagingPctOfTicket ?? 0) < 6) return false;
    // A pack is filled to the BOX's volume, so "pack bigger" only ever means
    // stepping up a box size (~2x capacity). Only propose that where the
    // current pack is a cheap one AND the doubled pack still lands at a price
    // a shopper would plausibly pay for a take-home size.
    const ticket = e.ticket ?? 0;
    return ticket > 0 && ticket <= IMPULSE_TICKET_MAX && ticket * 2 <= TAKE_HOME_TICKET_MAX;
  },
  build: (p, f) => {
    const e = econ(p);
    // The physical step: the next box up holds roughly twice the volume and
    // costs only ~0.07 more. We never invent an arbitrary gram target — the
    // fill is whatever that box holds for THIS product's density.
    const target = Math.round(((p.packSizeG ?? 0) * 2) / 5) * 5;
    const saving = repackSaving(p.units || 0, p.packSizeG ?? 0, target, p.packagingCost ?? 0);
    const bigTicket = Math.round((e.ticket ?? 0) * 2);
    return draft({
      title: `Add a larger ${p.name} pack — packaging takes ${pct(e.packagingPctOfTicket)} of the small one`,
      domain: "packaging", type: "larger_value_size", product: p,
      observedFacts: [
        `${p.name} sells at about ${egp(e.ticket ?? 0)} a pack (${Math.round(p.packSizeG ?? 0)}g — a full small box).`,
        `The box + sticker costs ${egp(p.packagingCost ?? 0)} — ${pct(e.packagingPctOfTicket)} of that price.`,
        e.trueMarginPct != null ? `Margin falls from ${pct(e.grossMarginPct)} to ${pct(e.trueMarginPct)} once the mall's cut and packaging come off.` : "",
      ].filter(Boolean),
      principles: [
        "A flat per-pack cost is a bigger tax the cheaper the pack.",
        "Pack size is set by box volume and by the shopper's occasion — never by the maths alone.",
      ],
      reasoning: [
        "The same box is used regardless of what goes in it, so a small pack pays the same as a large one.",
        "The next box up holds about twice the volume for roughly the same cost, halving packaging per kg.",
        "The larger pack serves a take-home shopper, so it should sit ALONGSIDE the small one rather than replace it — the small pack is what the impulse buyer wants.",
      ],
      truthLevel: "strong_inference",
      proposedAction: `Add a second, larger ${p.name} pack in the next box up — about ${target}g at roughly ${egp(bigTicket)} — and keep the current ${Math.round(p.packSizeG ?? 0)}g pack for impulse buyers.` +
        (saving ? ` Every shopper who trades up saves you the cost of a whole extra pack.` : ""),
      implementationSteps: [
        `Fill the next box size up with ${p.name} — it will hold roughly ${target}g at this product's density.`,
        "Keep the price per kg unchanged; only the pack size differs.",
        "Face both sizes side by side and hold for two cheque cycles.",
        "Compare total units and packs used — success is the same volume in fewer packs.",
      ],
      contraindications: ["If this line is a deliberate low-price impulse buy, test on half the facings first."],
      timing: "this week", durationDays: 21, effort: "low",
      mechanism: "Fewer packs for the same volume means proportionally less packaging cost.",
      expectedBenefitType: "packaging cost saved",
      confidence: "high",
      evidence: [
        ev("Pack size", `${Math.round(p.packSizeG ?? 0)}g`, "products", f.period, "/stock"),
        ev("Packaging per pack", egp(p.packagingCost ?? 0), "packaging_formats", f.period, "/stock"),
        ev("Packaging share of price", pct(e.packagingPctOfTicket), "unit economics", f.period, "/health"),
      ],
      screenLink: "/stock",
      successCriteria: ["Packs used per kg falls.", "Units sold holds within 10%."],
      failureCriteria: ["Units drop more than 10%."],
      stopCondition: "If units fall more than 10%, revert to the smaller fill.",
    });
  },
};

/* ═══ 2. True margin below floor although gross margin looks fine ═══════════ */

const trueMarginBelowFloor: KnowledgePlaybook = {
  id: "true-margin-below-floor", domain: "margin",
  title: "Looks profitable on paper, isn't after the mall's cut",
  principle: "Gross margin is not what you keep. Judge a line on margin after commission and packaging.",
  conditions: "Gross margin clears the floor but true margin (after commission + packaging) does not.",
  requiredEvidence: ["selling price", "cost", "pack weight", "packaging cost"],
  contraindications: ["deliberate traffic-driver", "owner-flagged strategic line"],
  mechanism: "Repricing or repacking restores the margin the gross figure implied.",
  actionTypes: ["restore_margin", "review_price"],
  expectedBenefitType: "margin restored", risks: ["price rise may slow units"],
  testDesign: "Adjust and hold for two cheque cycles, watching units.",
  minTestDurationDays: 21, successMetrics: ["true margin reaches the floor"], failureMetrics: ["units fall more than 10%"],
  confidenceCeiling: "high", basis: "retail_math", version: 1,
  rationale: "Reporting gross margin alone systematically overstates what low-ticket and commission-bearing lines contribute.",
  kpis: ["true margin %"], reviewCadenceDays: 30,
  match: (p, f) => {
    if (!hasPackFacts(p)) return false;
    if (p.doNotDiscontinue || f.strategicProducts.includes(p.name) || p.ownerTrafficDriver) return false;
    const floor = f.marginFloorPct ?? 30;
    const e = econ(p);
    return (e.grossMarginPct ?? 0) >= floor && (e.trueMarginPct ?? 0) < floor;
  },
  build: (p, f) => {
    const e = econ(p);
    const floor = f.marginFloorPct ?? 30;
    return draft({
      title: `${p.name} clears ${pct(floor)} on paper but keeps only ${pct(e.trueMarginPct)}`,
      domain: "margin", type: "restore_margin", product: p,
      observedFacts: [
        `Gross margin is ${pct(e.grossMarginPct)}, which clears your ${pct(floor)} floor.`,
        `After the mall's ${pct(COMMISSION_PCT * 100)} commission and ${egp(p.packagingCost ?? 0)} of packaging, you keep ${pct(e.trueMarginPct)}.`,
        `That is ${pct(e.marginPointsLost)} of margin lost after the headline number.`,
      ],
      principles: ["Judge a line on what reaches your pocket, not on price minus cost."],
      reasoning: [
        "Commission scales with price and packaging is a flat charge per pack; neither appears in gross margin.",
        "Lines that pass on gross but fail on true margin quietly drag the whole portfolio.",
      ],
      truthLevel: "measured_conclusion",
      proposedAction: `Restore ${p.name} to your floor — either raise the price per kg, or increase the pack size so packaging costs less per kg.`,
      implementationSteps: [
        "Decide between a price rise and a larger pack (larger pack risks nothing on price).",
        "Apply it and hold for two cheque cycles.",
        "Re-check true margin, not gross.",
      ],
      contraindications: ["If this line exists to pull traffic, leave it and mark it strategic."],
      timing: "this month", durationDays: 21, effort: "low",
      mechanism: "Either lever widens the gap between price and total variable cost.",
      expectedBenefitType: "margin restored",
      confidence: "high",
      evidence: [
        ev("Gross margin", pct(e.grossMarginPct), "read/profit", f.period, "/reconcile"),
        ev("True margin", pct(e.trueMarginPct), "unit economics", f.period, "/health"),
        ev("Margin floor", pct(floor), "owner target", f.period, "/health"),
      ],
      screenLink: "/health",
      successCriteria: [`True margin reaches ${pct(floor)}.`],
      failureCriteria: ["Units fall more than 10%."],
      stopCondition: "If units fall more than 10% after a price rise, revert and use pack size instead.",
    });
  },
};

/* ═══ 3. Same cost, cheaper price — an unforced pricing error ═══════════════ */

const underpricedVsSibling: KnowledgePlaybook = {
  id: "underpriced-vs-sibling", domain: "pricing",
  title: "A near-identical product is priced lower for no reason",
  principle: "Two lines that cost the same to buy should not be priced far apart unless the customer sees a difference.",
  conditions: "Two products share essentially the same cost per kg but differ materially in price.",
  requiredEvidence: ["cost per kg for both", "price per kg for both"],
  contraindications: ["a genuine grade/quality difference the customer recognises", "deliberate entry-price line"],
  mechanism: "Lifting the cheaper line toward its twin captures margin already proven acceptable at the higher price.",
  actionTypes: ["test_price_increase"],
  expectedBenefitType: "margin recovered", risks: ["the cheaper line may serve a different shopper"],
  testDesign: "Raise the cheaper line partway to its twin and hold two cheque cycles.",
  minTestDurationDays: 21, successMetrics: ["margin rises", "units hold"], failureMetrics: ["units fall sharply"],
  confidenceCeiling: "medium", basis: "retail_math", version: 1,
  rationale: "The higher price is already being paid for a product costing the same, so the market has demonstrated it will bear it.",
  whenNotApplicable: "Where the two genuinely differ in grade, origin or preparation in a way shoppers value.",
  kpis: ["true margin %", "units"], reviewCadenceDays: 30,
  global: (f: RetailBusinessFacts): RecommendationDraft[] => {
    const out: RecommendationDraft[] = [];
    const priced = f.products.filter((p) => p.avgCost > 0 && (p.sellingPrice ?? 0) > 0);
    for (const low of priced) {
      const twin = priced.find((h) =>
        h.name !== low.name &&
        Math.abs(h.avgCost - low.avgCost) / low.avgCost <= 0.02 &&        // same cost within 2%
        (h.sellingPrice ?? 0) > (low.sellingPrice ?? 0) * 1.08);           // priced >8% higher
      if (!twin) continue;
      const e = econ(low), te = econ(twin);
      const d = draft({
        title: `${low.name} is priced ${egp((twin.sellingPrice ?? 0) - (low.sellingPrice ?? 0))}/kg below ${twin.name} — same cost`,
        domain: "pricing", type: "test_price_increase", product: low,
        affectedProducts: [low.name, twin.name],
        observedFacts: [
          `${low.name} and ${twin.name} both cost about ${egp(low.avgCost)}/kg to buy.`,
          `${low.name} sells at ${egp(low.sellingPrice ?? 0)}/kg; ${twin.name} sells at ${egp(twin.sellingPrice ?? 0)}/kg.`,
          e.trueMarginPct != null && te.trueMarginPct != null
            ? `True margin: ${pct(e.trueMarginPct)} versus ${pct(te.trueMarginPct)}.` : "",
        ].filter(Boolean),
        principles: ["Identical input cost should not carry a large price gap unless shoppers see a difference."],
        reasoning: [
          `Customers already pay ${egp(twin.sellingPrice ?? 0)}/kg for a product that costs you the same.`,
          "The gap is very likely a pricing oversight rather than a positioning decision.",
        ],
        truthLevel: "strong_inference",
        proposedAction: `Raise ${low.name} toward ${egp(twin.sellingPrice ?? 0)}/kg — unless shoppers genuinely see it as the lesser product.`,
        implementationSteps: [
          `Update ${low.name}'s price per kg in the till system.`,
          "Hold for two cheque cycles.",
          "Watch units — if they hold, keep it; the margin gain is permanent.",
        ],
        contraindications: ["If the two differ in grade or preparation in a way customers value, leave the gap."],
        timing: "this week", durationDays: 21, effort: "low",
        mechanism: "Aligning price to a proven willingness-to-pay on an identical cost base.",
        expectedBenefitType: "margin recovered",
        confidence: "medium",
        evidence: [
          ev(`${low.name} cost`, egp(low.avgCost), "products", f.period, "/costs"),
          ev(`${twin.name} cost`, egp(twin.avgCost), "products", f.period, "/costs"),
          ev("Price gap", egp((twin.sellingPrice ?? 0) - (low.sellingPrice ?? 0)), "products", f.period, "/costs"),
        ],
        screenLink: "/costs",
        successCriteria: ["Margin rises and units hold."],
        failureCriteria: ["Units fall sharply after the rise."],
        stopCondition: "If units drop more than 15%, step the price back halfway.",
      });
      if (d) out.push(d);
    }
    return out;
  },
};

/* ═══ 4. A high-margin line that isn't on the shelf every day ═══════════════ */

const availabilityGap: KnowledgePlaybook = {
  id: "availability-gap", domain: "merchandising",
  title: "A strong-margin line is missing from the shelf too often",
  principle: "A product earns nothing on the days it isn't there. Availability is cheaper than any promotion.",
  conditions: "A product with above-floor margin sold on far fewer days than the range's best-covered lines.",
  requiredEvidence: ["days sold in period", "margin"],
  contraindications: ["deliberately seasonal or occasional line", "supply genuinely unavailable"],
  mechanism: "Closing the availability gap converts already-proven demand on days currently lost.",
  actionTypes: ["increase_facings", "expand"],
  expectedBenefitType: "recovered sales", risks: ["needs working capital to hold more stock"],
  testDesign: "Guarantee daily presence for one month and compare days sold and contribution.",
  minTestDurationDays: 30, successMetrics: ["days sold rises toward the best lines"], failureMetrics: ["stock ages unsold"],
  confidenceCeiling: "medium", basis: "retail_math", version: 1,
  rationale: "Gaps on shelf are invisible in revenue reports — the sale simply never happens, so it is never counted as a loss.",
  whenNotApplicable: "Genuinely seasonal lines, or where the supplier cannot deliver continuously.",
  kpis: ["days sold", "contribution"], reviewCadenceDays: 30,
  match: (p, f) => {
    const floor = f.marginFloorPct ?? 30;
    if ((p.marginPct ?? 0) < floor) return false;
    const best = Math.max(...f.products.map((x) => x.daysSold), 0);
    return best >= 20 && p.daysSold > 0 && p.daysSold < best * 0.7;
  },
  build: (p, f) => {
    const best = Math.max(...f.products.map((x) => x.daysSold), 0);
    const missed = best - p.daysSold;
    const perDay = p.daysSold > 0 ? p.revenue / p.daysSold : 0;
    return draft({
      title: `${p.name} earns ${pct(p.marginPct)} but was only on shelf ${p.daysSold} of ${best} days`,
      domain: "merchandising", type: "increase_facings", product: p,
      observedFacts: [
        `${p.name} sold on ${p.daysSold} days; your best-covered lines sold on ${best}.`,
        `It carries a ${pct(p.marginPct)} margin — above your floor.`,
        perDay > 0 ? `On the days it is present it takes about ${egp(perDay)}.` : "",
      ].filter(Boolean),
      principles: ["A strong line missing from the shelf is a silent loss — it never shows up as a bad number."],
      reasoning: [
        `There were roughly ${missed} days when this product could have sold and didn't.`,
        "Because the margin is already above floor, closing the gap needs no price or promotion change.",
      ],
      truthLevel: "strong_inference",
      proposedAction: `Keep ${p.name} on the shelf every trading day — add it to the daily open checklist and hold enough stock to cover the gap.`,
      implementationSteps: [
        `Add ${p.name} to the morning presence check.`,
        "Hold enough backstock to cover a full cheque cycle.",
        "Re-check days-sold next month.",
      ],
      contraindications: ["If this line is deliberately seasonal, ignore.", "If the supplier can't deliver continuously, note it instead."],
      timing: "this week", durationDays: 30, effort: "low",
      mechanism: "Converting demand on days currently lost to an empty facing.",
      expectedBenefitType: "recovered sales",
      confidence: "medium",
      evidence: [
        ev("Days sold", `${p.daysSold}`, "read/products", f.period, "/sales"),
        ev("Best-covered line", `${best} days`, "read/products", f.period, "/sales"),
        ev("Margin", pct(p.marginPct), "read/profit", f.period, "/reconcile"),
      ],
      screenLink: "/stock",
      successCriteria: ["Days sold moves toward the best-covered lines."],
      failureCriteria: ["Stock ages unsold."],
      stopCondition: "If the extra stock ages without selling, the gap was demand, not availability.",
    });
  },
};

export const UNIT_ECONOMICS_KNOWLEDGE: KnowledgePlaybook[] = [
  packagingTaxRepack, trueMarginBelowFloor, underpricedVsSibling, availabilityGap,
];
