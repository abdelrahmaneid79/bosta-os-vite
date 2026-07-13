import { describe, it, expect } from "vitest";
import { validateModelCandidate, ingestCandidates } from "@/core/strategist/retail/candidates";
import { runRetailReasoning, runReasoningWithCandidates } from "@/core/strategist/retail/reasoning";
import { marginIntelligence, merchandisingPackagingIntelligence } from "@/core/strategist/retail/domains";
import { renderRecommendation } from "@/core/strategist/retail/nlg";
import type { ProductFact, RetailBusinessFacts } from "@/core/strategist/retail/contract";

const P = (o: Partial<ProductFact>): ProductFact => ({
  id: null, name: "X", category: null, revenue: 1000, grossProfit: 400, marginPct: 40, units: 100, cogs: 600,
  daysSold: 20, velocityPerDay: 5, revenueSharePct: 10, profitSharePct: 10, growthPct: 0, onHand: 50,
  inventoryValue: 1000, inventorySharePct: 10, daysCover: 20, sellingPrice: 10, avgCost: 6, hasCost: true,
  isLow: false, vendor: null, packagingFormat: null, packSizeG: null, packagingCost: null, displayZone: null,
  shelfLevel: null, facings: null, tier: null, impulseType: null, minOrderQty: null, supplierLeadDays: null, quantityBreaks: null, doNotDiscontinue: false, ownerTrafficDriver: false, ...o,
});
const F = (products: ProductFact[], o: Partial<RetailBusinessFacts> = {}): RetailBusinessFacts => ({
  period: "2026-05", comparePeriod: "2026-04", products, totalRevenue: 20000, totalGrossProfit: 8000,
  coveragePct: 92, inventoryTracked: true, stockCountAgeDays: 3, cashCountFresh: true, marginFloorPct: 30,
  maxCoverDays: 45, deadStockDays: 60, strategicProducts: [], cashForPurchases: 5000, nextChequeEta: "2026-05-25",
  season: null, offeredPackaging: [], allowedPromotions: [], allowedDisplayChanges: [], customerOccasions: [], operationalConstraints: [], commonlyBoughtTogether: [], isStale: false, staleDays: 0, basisNote: "", ...o,
});
const OPTS = { today: "2026-05-15", maxRecommendations: 30 };

describe("authorship boundary — the model may author ideas, not truth", () => {
  const facts = F([P({ name: "Cashews", profitSharePct: 30, revenueSharePct: 9, marginPct: 35 }), P({ name: "Jelly", revenueSharePct: 22 })]);

  it("rejects a model idea that names an unknown product (no inventing facts)", () => {
    const r = validateModelCandidate({
      title: "x", domain: "merchandising", type: "improve_adjacency", affectedProducts: ["Truffles"],
      proposedAction: "move it", reasoning: ["because"], testDesign: "two cycles", successCriteria: ["profit up"],
    }, facts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(" ")).toMatch(/unknown product/i);
  });

  it("rejects a model idea with no measurable test", () => {
    const r = validateModelCandidate({
      title: "x", domain: "merchandising", type: "improve_adjacency", affectedProducts: ["Cashews"],
      proposedAction: "move it", reasoning: ["because"],
    }, facts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(" ")).toMatch(/test|success/i);
  });

  it("accepts a well-formed model idea, grounds its evidence, and labels it model_reasoning (never measured)", () => {
    const v = validateModelCandidate({
      title: "Cashews beside Jelly", domain: "merchandising", type: "improve_adjacency", affectedProducts: ["Cashews"],
      proposedAction: "Trial cashews beside jelly candy", reasoning: ["Jelly drives traffic; cashews monetise it."],
      testDesign: "Two cheque cycles; measure profit per facing.", successCriteria: ["gross profit per facing up"],
      failureCriteria: ["jelly sales dip"],
    }, facts);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const { accepted } = ingestCandidates([v.candidate], facts, OPTS);
    expect(accepted).toHaveLength(1);
    const r = accepted[0];
    expect(r.source).toBe("model_reasoning");
    expect(r.truthLevel).toBe("experiment_hypothesis");     // a model idea can never be "measured"
    expect(r.confidence).not.toBe("high");                  // capped
    expect(r.evidence.length).toBeGreaterThan(0);           // evidence re-attached from real facts
    expect(r.evidence[0].value).toMatch(/%/);
  });

  it("a validated model idea joins deterministic recs through the shared pipeline", () => {
    const v = validateModelCandidate({
      title: "Cashews beside Jelly", domain: "merchandising", type: "improve_adjacency", affectedProducts: ["Cashews"],
      proposedAction: "Trial cashews beside jelly candy", reasoning: ["Jelly drives traffic."],
      testDesign: "Two cheque cycles.", successCriteria: ["profit per facing up"], failureCriteria: ["jelly dips"],
    }, facts);
    if (!v.ok) throw new Error("expected valid");
    const { accepted } = runReasoningWithCandidates(facts, OPTS, [v.candidate]);
    expect(accepted.some((r) => r.source === "model_reasoning")).toBe(true);
    expect(accepted.some((r) => r.source === "deterministic_knowledge")).toBe(true); // both sources, one pipeline
  });

  it("a model idea that violates a cash constraint is rejected by the same gate", () => {
    const v = validateModelCandidate({
      title: "Buy cashews now", domain: "purchase", type: "buy_now", affectedProducts: ["Cashews"],
      proposedAction: "buy now", reasoning: ["low stock"], testDesign: "n/a", successCriteria: ["no stockout"],
    }, F([P({ name: "Cashews" })], { cashForPurchases: 0 }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const { accepted, rejected } = ingestCandidates([v.candidate], F([P({ name: "Cashews" })], { cashForPurchases: 0 }), OPTS);
    expect(accepted).toHaveLength(0);
    expect(rejected.some((x) => x.source === "model_reasoning")).toBe(true);
  });
});

describe("provenance labelling", () => {
  it("deterministic recommendations carry deterministic_knowledge and render a Source line", () => {
    const recs = runRetailReasoning(F([P({ name: "Almonds", inventorySharePct: 12, profitSharePct: 2, growthPct: -8 })]), OPTS);
    expect(recs[0].source).toBe("deterministic_knowledge");
    expect(renderRecommendation(recs[0]).text).toMatch(/Source: Deterministic retail knowledge/);
  });
});

describe("reference domain engines", () => {
  const facts = F([
    P({ name: "Almonds", marginPct: 16, revenueSharePct: 8, growthPct: 0, profitSharePct: 4 }),    // margin/pricing (not growing → margin-recovery)
    P({ name: "Pecans", profitSharePct: 22, facings: 1 }),                                          // shelf
    P({ name: "Bulk Raisins", profitSharePct: 2, facings: 4 }),                                     // shelf
  ]);
  it("Margin Intelligence returns only margin/pricing recommendations", () => {
    const recs = marginIntelligence.analyze(facts, OPTS);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => ["margin", "pricing"].includes(r.domain))).toBe(true);
  });
  it("Merchandising & Packaging Intelligence returns only its domains", () => {
    const recs = merchandisingPackagingIntelligence.analyze(facts, OPTS);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => ["merchandising", "shelf", "packaging"].includes(r.domain))).toBe(true);
  });
});
