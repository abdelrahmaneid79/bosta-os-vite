/** The rebuilt strategist: one goal — grow revenue, cut cost, protect the
 *  brand — and advice that is ranked by what it is WORTH rather than filtered
 *  by how complete the books are.
 *
 *  The fixtures below are the real Gardenia stand: the zones, the empty wall
 *  bay, the unbranded checkout towers and the summer trough the business is
 *  actually trading through. */
import { describe, it, expect } from "vitest";
import { runRetailReasoning } from "@/core/strategist/retail/reasoning";
import { expectedValue, scoreRecommendations, summariseObjective } from "@/core/strategist/retail/objective";
import { seasonOn, nextSeason, seasonCalendar } from "@/core/strategist/retail/season";
import { gateRecommendation } from "@/core/strategist/retail/quality-gate";
import type { ProductFact, RetailBusinessFacts, RetailRecommendation, ZoneFact } from "@/core/strategist/retail/contract";

const P = (o: Partial<ProductFact>): ProductFact => ({
  id: "id-x", name: "X", category: null, revenue: 1000, grossProfit: 400, marginPct: 40, units: 100, cogs: 600,
  daysSold: 20, velocityPerDay: 5, marginDeltaPts: null, revenueSharePct: 10, profitSharePct: 10, growthPct: 0,
  onHand: 50, inventoryValue: 1000, inventorySharePct: 10, daysCover: 20, sellingPrice: 10, avgCost: 6,
  hasCost: true, isLow: false, vendor: null, packagingFormat: null, packSizeG: null, packagingCost: null,
  displayZone: null, shelfLevel: null, facings: null, tier: null, impulseType: null, minOrderQty: null,
  supplierLeadDays: null, quantityBreaks: null, doNotDiscontinue: false, ownerTrafficDriver: false, ...o,
});

const Z = (o: Partial<ZoneFact>): ZoneFact => ({
  key: "z", name: "Zone", tier: "value_volume", traffic: "high", facings: 10,
  lit: false, branded: false, signage: null, notes: null, active: true, ...o,
});

/** The stand as it actually is today. */
const GARDENIA_ZONES: ZoneFact[] = [
  Z({ key: "main_table", name: "Main satin-skirted display table", tier: "value_volume", traffic: "high", facings: 200 }),
  Z({ key: "gridwall_nuts", name: "Checkout gridwall tower B - nuts", tier: "premium_impulse", traffic: "aisle_end", facings: 24 }),
  Z({ key: "gridwall_candy", name: "Checkout gridwall tower A - candy", tier: "impulse", traffic: "aisle_end", facings: 24 }),
  Z({ key: "empty_wall_bay", name: "EMPTY wall bay (former illuminated stand)", tier: "opportunity", traffic: "destination", facings: 0 }),
  Z({ key: "cereal_tier", name: "Front table tier vacated by cereal lines", tier: "opportunity", traffic: "high", facings: 40 }),
];

const F = (o: Partial<RetailBusinessFacts> = {}): RetailBusinessFacts => ({
  period: "2026-07", comparePeriod: "2026-06",
  products: [P({ name: "Walnuts", tier: "premium", sellingPrice: 145, marginPct: 19, revenue: 9000, packSizeG: 180, packagingCost: 3.96, units: 62 }),
             P({ name: "Sunflower Seeds", tier: "value", sellingPrice: 45, marginPct: 38, revenue: 6000, packSizeG: 260, packagingCost: 3.2, units: 133 })],
  totalRevenue: 87000, totalGrossProfit: 26000,
  coveragePct: null, inventoryTracked: false, stockCountAgeDays: null, cashCountFresh: false,
  marginFloorPct: 30, maxCoverDays: 45, deadStockDays: 60, strategicProducts: [],
  cashForPurchases: null, nextChequeEta: null, season: null, nextSeason: null,
  zones: GARDENIA_ZONES, observations: [], locationProfile: null,
  offeredPackaging: [], allowedPromotions: [], allowedDisplayChanges: [], customerOccasions: [],
  operationalConstraints: [], commonlyBoughtTogether: [], isStale: true, staleDays: 4, basisNote: "", ...o,
});

const OPTS = { today: "2026-07-18", maxRecommendations: 30 };
const run = (f: RetailBusinessFacts) => runRetailReasoning(f, OPTS);
const pick = (rs: RetailRecommendation[], id: string) => rs.find((r) => r.playbookId === id);

describe("the objective — advise, never withhold", () => {
  it("still advises on thin books, where the old engine returned nothing", () => {
    // coverage unknown, no stock counts, no cash count, books 4 days stale:
    // the exact state that used to produce "nothing clears the evidence bar"
    const recs = run(F());
    expect(recs.length).toBeGreaterThan(0);
  });

  it("ranks by what a move is worth, not by how certain it is", () => {
    const big = { impact: { monthlyEgp: 9000, basis: "40 idle facings x your own per-facing average", kind: "arithmetic" as const, lever: "revenue" as const },
      confidence: "low" as const, brandEffect: "neutral" as const, effort: "medium" as const, truthLevel: "strong_inference" as const,
      financialImpactEgp: 9000 } as RetailRecommendation;
    const small = { impact: { monthlyEgp: 200, basis: "measured directly from your product lines", kind: "measured" as const, lever: "cost" as const },
      confidence: "high" as const, brandEffect: "neutral" as const, effort: "low" as const, truthLevel: "measured_conclusion" as const,
      financialImpactEgp: 200 } as RetailRecommendation;
    expect(expectedValue(big)).toBeGreaterThan(expectedValue(small));
  });

  it("discounts a brand-cheapening move against an equal brand-building one", () => {
    const base = { impact: { monthlyEgp: 5000, basis: "same arithmetic on both sides", kind: "arithmetic" as const, lever: "revenue" as const },
      confidence: "medium" as const, effort: "low" as const, truthLevel: "strong_inference" as const, financialImpactEgp: 5000 };
    const builds = { ...base, brandEffect: "builds" as const } as RetailRecommendation;
    const risks = { ...base, brandEffect: "risks" as const } as RetailRecommendation;
    expect(expectedValue(builds)).toBeGreaterThan(expectedValue(risks));
  });

  it("splits the prize into revenue and cost so the owner sees both levers", () => {
    const s = summariseObjective(scoreRecommendations(run(F())));
    expect(s.totalEgp).toBe(s.revenueUpsideEgp + s.costSavingEgp);
    expect(s.count).toBeGreaterThan(0);
  });
});

describe("the stand — advice about the shop, not just the books", () => {
  it("prices the empty front tier from the owner's own revenue per facing", () => {
    const r = pick(run(F()), "dead-prime-space");
    expect(r).toBeTruthy();
    // 248 selling facings across 87,000 → ~351/facing; 40 idle facings, halved
    expect(r!.impact!.monthlyEgp).toBeGreaterThan(5000);
    expect(r!.impact!.monthlyEgp).toBeLessThan(9000);
    expect(r!.impact!.basis).toMatch(/facing/i);
  });

  it("calls out that nothing on the stand is lit and branded", () => {
    const r = pick(run(F()), "no-premium-stage");
    expect(r).toBeTruthy();
    expect(r!.brandEffect).toBe("builds");
    expect(r!.impact!.monthlyEgp).toBeGreaterThan(0);
  });

  it("asks for a brand header on the unbranded selling fixtures", () => {
    expect(pick(run(F()), "unbranded-selling-zone")).toBeTruthy();
  });

  it("catches the premium pack that is smaller than a pack a third of the price", () => {
    // With box costs recorded, the unit-economics playbook proposes the same
    // repack for harder reasons and wins the shared slot — one action, one
    // card. Drop the box costs and the visual-comparison reason stands alone.
    const noBoxCosts = F({ products: [
      P({ name: "Walnuts", tier: "premium", sellingPrice: 145, marginPct: 19, revenue: 9000, packSizeG: 180, units: 62 }),
      P({ name: "Sunflower Seeds", tier: "value", sellingPrice: 45, marginPct: 38, revenue: 6000, packSizeG: 260, units: 133 }),
    ] });
    const r = pick(run(noBoxCosts), "premium-looks-smaller");
    expect(r).toBeTruthy();
    expect(r!.affectedProducts[0]).toBe("Walnuts");
  });

  it("shows one repack card for a product, not two saying the same thing", () => {
    const repacks = run(F()).filter((r) => r.type === "larger_value_size" && r.affectedProducts[0] === "Walnuts");
    expect(repacks).toHaveLength(1);
  });

  it("says nothing about a stand that is already lit, branded and full", () => {
    const good = F({ zones: [Z({ key: "wall", name: "Wall", tier: "premium_impulse", lit: true, branded: true, facings: 30 })] });
    expect(pick(run(good), "dead-prime-space")).toBeUndefined();
    expect(pick(run(good), "no-premium-stage")).toBeUndefined();
    expect(pick(run(good), "unbranded-selling-zone")).toBeUndefined();
  });

  it("turns the owner's own open audit findings into one piece of work", () => {
    const withFindings = F({ observations: [
      { category: "branding", severity: "major", finding: "15-20% of packs carry no brand sticker", recommendation: "Add stickering to the packing checklist" },
      { category: "hygiene", severity: "major", finding: "Visible residue on the selling surface", recommendation: "End-of-shift wipe-down" },
    ] });
    const r = pick(run(withFindings), "open-branch-findings");
    expect(r).toBeTruthy();
    expect(r!.implementationSteps.length).toBe(2);
  });
});

describe("the retail calendar", () => {
  it("knows July is the summer trough, not a failing business", () => {
    expect(seasonOn("2026-07-18")?.season).toBe("summer_slow");
  });

  it("reframes the trough instead of recommending cuts", () => {
    const r = pick(run(F({ season: "summer_slow" })), "season-prep");
    expect(r).toBeTruthy();
    expect(r!.proposedAction.toLowerCase()).not.toMatch(/discontinue|cut the range/);
  });

  it("puts Ramadan and the winter nut season on the calendar", () => {
    const cal = seasonCalendar();
    expect(cal.some((w) => w.season === "ramadan")).toBe(true);
    expect(cal.some((w) => w.season === "winter_nuts")).toBe(true);
  });

  it("gives lead time on the next season rather than announcing it late", () => {
    const n = nextSeason("2026-07-18");
    expect(n).toBeTruthy();
    expect(n!.weeksAway).toBeGreaterThan(0);
    expect(n!.window.from > "2026-07-18").toBe(true);
  });

  it("raises a prepare-now play once inside the lead-time window", () => {
    const soon = F({ nextSeason: { season: "winter_nuts", name: "Winter nut season 2026", startsOn: "2026-11-01", weeksAway: 4 } });
    expect(pick(run(soon), "season-prep")).toBeTruthy();
  });
});

describe("what still gets blocked", () => {
  const base = (o: Partial<RetailRecommendation>): RetailRecommendation => ({
    id: "t", dedupeKey: "k", playbookId: "pb", title: "t", domain: "merchandising", type: "review_display_space",
    affectedProducts: ["X"], affectedProductIds: [], affectedCategory: null, affectedLocation: null,
    observedFacts: ["fact"], principles: ["p"], reasoning: ["r"], truthLevel: "strong_inference",
    proposedAction: "do the thing", implementationSteps: [], timing: "now", durationDays: null, effort: "low",
    mechanism: "m", expectedBenefitType: "b", financialImpactEgp: null, impact: null, brandEffect: "neutral",
    risks: [], contraindications: [], assumptions: [], missingInformation: [], sharpenWith: null,
    confidence: "medium", confidenceCeiling: "high",
    evidence: [{ label: "L", value: "V", source: "s", period: "p", screenLink: "/" }], screenLink: "/",
    testDesign: null, baselineMetrics: [], successCriteria: ["works"], failureCriteria: [],
    stopCondition: "stop", reviewDate: "2026-08-01", persistEligible: true, priorityScore: 1,
    source: "deterministic_knowledge", ...o,
  });
  const f = F();

  it("blocks a money figure with no arithmetic behind it", () => {
    expect(gateRecommendation(base({ impact: { monthlyEgp: 5000, basis: "big win", kind: "arithmetic", lever: "revenue" } }), f).ok).toBe(false);
  });
  it("blocks advice with no action in it", () => {
    expect(gateRecommendation(base({ proposedAction: "  " }), f).ok).toBe(false);
  });
  it("blocks a brand-damaging move that earns nothing", () => {
    expect(gateRecommendation(base({ brandEffect: "risks" }), f).ok).toBe(false);
  });
  it("does NOT block advice merely for being uncertain", () => {
    expect(gateRecommendation(base({ confidence: "low" }), f).ok).toBe(true);
  });
});
