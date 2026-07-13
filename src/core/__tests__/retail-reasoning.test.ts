import { describe, it, expect } from "vitest";
import { runRetailReasoning } from "@/core/strategist/retail/reasoning";
import { gateRecommendation, isLowValue } from "@/core/strategist/retail/quality-gate";
import { renderRecommendation, BANNED_FILLER } from "@/core/strategist/retail/nlg";
import { composeRetailFacts } from "@/core/strategist/retail/facts";
import type { ProductFact, RetailBusinessFacts, RetailRecommendation } from "@/core/strategist/retail/contract";

const P = (o: Partial<ProductFact>): ProductFact => ({
  id: null, name: "X", category: null, revenue: 1000, grossProfit: 400, marginPct: 40, units: 100, cogs: 600,
  daysSold: 20, velocityPerDay: 5, revenueSharePct: 10, profitSharePct: 10, growthPct: 0, onHand: 50,
  inventoryValue: 1000, inventorySharePct: 10, daysCover: 20, sellingPrice: 10, avgCost: 6, hasCost: true,
  isLow: false, vendor: null, packagingFormat: null, packSizeG: null, packagingCost: null, displayZone: null,
  shelfLevel: null, facings: null, tier: null, impulseType: null, minOrderQty: null, supplierLeadDays: null, ...o,
});
const F = (products: ProductFact[], o: Partial<RetailBusinessFacts> = {}): RetailBusinessFacts => ({
  period: "2026-05", comparePeriod: "2026-04", products, totalRevenue: 20000, totalGrossProfit: 8000,
  coveragePct: 92, inventoryTracked: true, stockCountAgeDays: 3, cashCountFresh: true, marginFloorPct: 30,
  maxCoverDays: 45, deadStockDays: 60, strategicProducts: [], cashForPurchases: 5000, nextChequeEta: "2026-05-25",
  season: null, isStale: false, staleDays: 0, basisNote: "", ...o,
});
const OPTS = { today: "2026-05-15", maxRecommendations: 30 };
const run = (f: RetailBusinessFacts) => runRetailReasoning(f, OPTS);
const byPlaybook = (recs: RetailRecommendation[], id: string) => recs.find((r) => r.playbookId === id);

describe("retail reasoning — grounded, specific recommendations", () => {
  it("almonds: high inventory value, weak profit → pause purchasing (measured)", () => {
    const r = byPlaybook(run(F([P({ name: "Almonds", inventorySharePct: 12, profitSharePct: 2.8, growthPct: -8, revenue: 2000, grossProfit: 224 })])), "high-value-slow-mover");
    expect(r).toBeTruthy();
    expect(r!.type).toBe("pause_purchasing");
    expect(r!.truthLevel).toBe("measured_conclusion");
    expect(r!.observedFacts.join(" ")).toMatch(/12%.*inventory/i);
  });

  it("cashews: high profit per inventory value is NOT flagged as a slow mover", () => {
    const recs = run(F([P({ name: "Cashews", inventorySharePct: 6, profitSharePct: 31, growthPct: 10 })]));
    expect(byPlaybook(recs, "high-value-slow-mover")).toBeUndefined();
  });

  it("growing product, margin below floor → mini-bag TEST (hypothesis), packaging cost missing", () => {
    const r = byPlaybook(run(F([P({ name: "Roasted Almonds", growthPct: 12, marginPct: 16.3, revenueSharePct: 8, profitSharePct: 5, packagingCost: null })])), "growing-margin-below-floor");
    expect(r).toBeTruthy();
    expect(r!.type).toBe("mini_bag_test");
    expect(r!.truthLevel).toBe("experiment_hypothesis");
    expect(r!.confidence).not.toBe("high");                 // a hypothesis is never high confidence
    expect(r!.missingInformation.join(" ")).toMatch(/packaging cost/i);
    expect(r!.testDesign).toBeTruthy();
  });

  it("high-volume low-margin traffic driver → protect price, fix mix", () => {
    const r = byPlaybook(run(F([P({ name: "Candy Mix", revenueSharePct: 22, marginPct: 18, velocityPerDay: 9, growthPct: 3 })])), "high-volume-low-margin-traffic");
    expect(r).toBeTruthy();
    expect(r!.type).toBe("avoid_price_change_mix");
    expect(r!.reasoning.join(" ")).toMatch(/mix, not this product's price|traffic/i);
  });

  it("strong profit driver with no facings recorded → space REVIEW, never a fabricated move", () => {
    const r = byPlaybook(run(F([P({ name: "Pecans", profitSharePct: 20, facings: null })])), "profit-driver-low-space");
    expect(r).toBeTruthy();
    expect(r!.type).toBe("review_display_space");           // not increase_facings — data is missing
    expect(r!.missingInformation.join(" ")).toMatch(/facings/i);
  });

  it("weak product with excess facings → reduce facings", () => {
    const r = byPlaybook(run(F([P({ name: "Bulk Raisins", profitSharePct: 2, facings: 4 })])), "weak-product-excess-facings");
    expect(r?.type).toBe("reduce_facings");
  });

  it("premium product, presentation unknown → premium block, needs zone", () => {
    const r = byPlaybook(run(F([P({ name: "Premium Pistachios", tier: "premium" })])), "premium-weak-presentation");
    expect(r).toBeTruthy();
    expect(r!.truthLevel).toBe("experiment_hypothesis");
    expect(r!.missingInformation.join(" ")).toMatch(/zone|level/i);
  });

  it("dead stock → convert as add-on", () => {
    const r = byPlaybook(run(F([P({ name: "Old Stock", onHand: 30, units: 0, daysSold: 0, revenue: 0, grossProfit: 0 })])), "dead-stock");
    expect(r?.type).toBe("weak_as_addon");
  });

  it("stockout risk on a profit driver, cash unavailable → buy AFTER cheque (never buy_now)", () => {
    const recs = run(F([P({ name: "Cashews", profitSharePct: 18, isLow: true })], { cashForPurchases: 0 }));
    const r = byPlaybook(recs, "stockout-risk-profit-driver");
    expect(r?.type).toBe("buy_after_cheque");
    expect(recs.every((x) => x.type !== "buy_now")).toBe(true);
  });

  it("don't discount a strong seller", () => {
    const r = byPlaybook(run(F([P({ name: "Best Seller", growthPct: 20, revenueSharePct: 16, marginPct: 42 })])), "avoid-discount-strong");
    expect(r?.type).toBe("avoid_discount_strong");
    expect(r?.truthLevel).toBe("measured_conclusion");
  });

  it("missing cost blocks profit → collect evidence", () => {
    const r = byPlaybook(run(F([P({ name: "Unknown Cost", hasCost: false, revenue: 500, grossProfit: null, marginPct: null, profitSharePct: null })])), "missing-cost-blocks-profit");
    expect(r?.type).toBe("collect_evidence");
  });

  it("revenue concentration risk (portfolio-level)", () => {
    const r = byPlaybook(run(F([P({ name: "Hero", revenueSharePct: 46 }), P({ name: "Other", revenueSharePct: 10 })])), "portfolio-concentration");
    expect(r).toBeTruthy();
    expect(r!.type).toBe("reduce_exposure");
  });

  it("Eid + premium → gift format (hypothesis)", () => {
    const r = byPlaybook(run(F([P({ name: "Gift Nuts", tier: "premium" })], { season: "eid" })), "eid-premium-packaging");
    expect(r?.type).toBe("gift_format");
    expect(r?.truthLevel).toBe("experiment_hypothesis");
  });
});

describe("confidence discipline", () => {
  it("stale books cap a measured claim below high confidence", () => {
    const r = byPlaybook(run(F([P({ name: "Almonds", inventorySharePct: 12, profitSharePct: 2, growthPct: -8 })], { isStale: true, staleDays: 20 })), "high-value-slow-mover");
    expect(r).toBeTruthy();
    expect(r!.confidence).not.toBe("high");
  });

  it("thin coverage downgrades a measured conclusion to a strong inference", () => {
    const r = byPlaybook(run(F([P({ name: "Almonds", inventorySharePct: 12, profitSharePct: 2, growthPct: -8 })], { coveragePct: 40 })), "high-value-slow-mover");
    expect(r).toBeTruthy();
    expect(r!.truthLevel).toBe("strong_inference");
  });
});

describe("quality gate", () => {
  const base = (o: Partial<RetailRecommendation>): RetailRecommendation => ({
    id: "t", dedupeKey: "k", playbookId: "pb", title: "t", domain: "inventory", type: "pause_purchasing",
    affectedProducts: ["X"], affectedProductIds: [], affectedCategory: null, affectedLocation: null,
    observedFacts: ["fact"], principles: ["p"], reasoning: ["r"], truthLevel: "measured_conclusion",
    proposedAction: "do", implementationSteps: [], timing: "now", durationDays: null, effort: "low",
    mechanism: "m", expectedBenefitType: "b", financialImpactEgp: 1000, risks: [], contraindications: [],
    assumptions: [], missingInformation: [], confidence: "high", confidenceCeiling: "high",
    evidence: [{ label: "L", value: "V", source: "s", period: "p", screenLink: "/" }], screenLink: "/",
    testDesign: null, baselineMetrics: [], successCriteria: ["done"], failureCriteria: [], stopCondition: "x",
    reviewDate: "2026-06-01", persistEligible: true, priorityScore: 5, ...o,
  });
  const f = F([]);
  it("passes a well-formed recommendation", () => {
    expect(gateRecommendation(base({}), f).ok).toBe(true);
  });
  it("rejects a hypothesis claiming high confidence", () => {
    expect(gateRecommendation(base({ truthLevel: "experiment_hypothesis", confidence: "high" }), f).ok).toBe(false);
  });
  it("rejects buy_now when cash is unavailable", () => {
    expect(gateRecommendation(base({ type: "buy_now" }), F([], { cashForPurchases: 0 })).ok).toBe(false);
  });
  it("rejects a recommendation with no success condition", () => {
    expect(gateRecommendation(base({ successCriteria: [], type: "pause_purchasing" }), f).ok).toBe(false);
  });
  it("suppresses low-value noise", () => {
    expect(isLowValue(base({ confidence: "low", financialImpactEgp: null, truthLevel: "strong_inference" }))).toBe(true);
    expect(isLowValue(base({ confidence: "low", financialImpactEgp: null, truthLevel: "experiment_hypothesis" }))).toBe(false);
  });
});

describe("deduplication", () => {
  it("drops a recommendation whose move is already an open action/experiment", () => {
    const full = run(F([P({ name: "Almonds", inventorySharePct: 12, profitSharePct: 2, growthPct: -8 })]));
    const key = byPlaybook(full, "high-value-slow-mover")!.dedupeKey;
    const deduped = runRetailReasoning(F([P({ name: "Almonds", inventorySharePct: 12, profitSharePct: 2, growthPct: -8 })]), { ...OPTS, openDedupeKeys: [key] });
    expect(byPlaybook(deduped, "high-value-slow-mover")).toBeUndefined();
  });
});

describe("deterministic executive language", () => {
  it("renders specific advice with classification + confidence and NO filler", () => {
    const r = byPlaybook(run(F([P({ name: "Roasted Almonds", growthPct: 12, marginPct: 16.3, revenueSharePct: 8, profitSharePct: 5 })])), "growing-margin-below-floor")!;
    const out = renderRecommendation(r);
    expect(out.text).toMatch(/Classification: Experiment hypothesis/);
    expect(out.text).toMatch(/Confidence: (Medium|Low)/);
    expect(out.text.toLowerCase()).toContain("mini-bag");
    for (const filler of BANNED_FILLER) expect(out.text.toLowerCase()).not.toContain(filler);
    // deterministic
    expect(renderRecommendation(r).text).toBe(out.text);
  });
});

describe("facts composition", () => {
  it("computes shares, velocity, growth and inventory value without inventing fields", () => {
    const f = composeRetailFacts({
      period: "2026-05", comparePeriod: "2026-04",
      detail: [{ name: "A", revenue: 5000, units: 200, grossProfit: 2000, marginPct: 40, missingCost: false, cogs: 3000, daysSold: 20 }],
      compareDetail: [{ name: "A", revenue: 4000, units: 160, grossProfit: 1600, marginPct: 40, missingCost: false, cogs: 2400, daysSold: 20 }],
      positions: [{ name: "A", sellingPrice: 25, avgCost: 15, hasCost: true, onHand: 40, isLow: false, vendor: null }],
      stockRisk: [{ name: "A", daysCover: 12, onHand: 40 }],
      periodDays: 20, merch: new Map(), totalRevenue: 10000, totalGrossProfit: 4000, coveragePct: 90,
      inventoryTracked: true, stockCountAgeDays: 2, cashCountFresh: true, marginFloorPct: 30, maxCoverDays: 45,
      deadStockDays: 60, strategicProducts: [], cashForPurchases: null, nextChequeEta: null, season: null, isStale: false, staleDays: 0,
    });
    const a = f.products[0];
    expect(a.revenueSharePct).toBe(50);
    expect(a.profitSharePct).toBe(50);
    expect(a.velocityPerDay).toBe(10);
    expect(a.growthPct).toBe(25);
    expect(a.inventoryValue).toBe(600);
    expect(a.facings).toBeNull();                          // not invented
  });
});
