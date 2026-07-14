import { describe, it, expect } from "vitest";
import { nextQuestions, interviewProgress, EMPTY_CONTEXT, type InterviewState } from "@/core/strategist/retail/interview";
import { runRetailReasoning } from "@/core/strategist/retail/reasoning";
import type { ProductFact, RetailBusinessFacts, RetailRecommendation, OfferedPackaging } from "@/core/strategist/retail/contract";

/* ── owner interview ─────────────────────────────────────────────────── */

const S = (o: Partial<InterviewState> = {}): InterviewState => ({
  context: EMPTY_CONTEXT, packagingCount: 0, activeProducts: 10, productsWithFacings: 0, productsWithZone: 0,
  productsWithTier: 0, productsWithPackaging: 0, productsWithSupplierTerms: 0, trafficDriversFlagged: 0,
  doNotDiscontinueFlagged: 0, adjacencyFlagged: 0, ...o,
});

describe("owner knowledge interview", () => {
  it("asks the highest-value question first (packaging formats)", () => {
    expect(nextQuestions(S())[0].id).toBe("packaging_formats");
  });
  it("does not re-ask a question answered from data", () => {
    const qs = nextQuestions(S({ packagingCount: 2 }));
    expect(qs.find((q) => q.id === "packaging_formats")).toBeUndefined();
  });
  it("does not re-ask a question the owner marked (incl. unknown)", () => {
    const qs = nextQuestions(S({ context: { ...EMPTY_CONTEXT, answeredKeys: ["facings"] } }));
    expect(qs.find((q) => q.id === "facings")).toBeUndefined();
  });
  it("counts a global-list answer as answered", () => {
    const before = interviewProgress(S()).answered;
    const after = interviewProgress(S({ context: { ...EMPTY_CONTEXT, allowedPromotions: ["bundles"] } })).answered;
    expect(after).toBe(before + 1);
  });
  it("every question explains why it matters and what it unlocks", () => {
    for (const q of nextQuestions(S(), 20)) { expect(q.why.length).toBeGreaterThan(10); expect(q.unlocks.length).toBeGreaterThan(0); }
  });
});

/* ── context makes advice specific ───────────────────────────────────── */

const P = (o: Partial<ProductFact>): ProductFact => ({
  id: null, name: "X", category: null, revenue: 1000, grossProfit: 400, marginPct: 40, units: 100, cogs: 600,
  daysSold: 20, velocityPerDay: 5, marginDeltaPts: null, revenueSharePct: 10, profitSharePct: 10, growthPct: 0, onHand: 50,
  inventoryValue: 1000, inventorySharePct: 10, daysCover: 20, sellingPrice: 10, avgCost: 6, hasCost: true,
  isLow: false, vendor: null, packagingFormat: null, packSizeG: null, packagingCost: null, displayZone: null,
  shelfLevel: null, facings: null, tier: null, impulseType: null, minOrderQty: null, supplierLeadDays: null,
  quantityBreaks: null, doNotDiscontinue: false, ownerTrafficDriver: false, ...o,
});
const F = (products: ProductFact[], o: Partial<RetailBusinessFacts> = {}): RetailBusinessFacts => ({
  period: "2026-05", comparePeriod: "2026-04", products, totalRevenue: 20000, totalGrossProfit: 8000,
  coveragePct: 92, inventoryTracked: true, stockCountAgeDays: 3, cashCountFresh: true, marginFloorPct: 30,
  maxCoverDays: 45, deadStockDays: 60, strategicProducts: [], cashForPurchases: 5000, nextChequeEta: "2026-05-25",
  season: null, offeredPackaging: [], allowedPromotions: [], allowedDisplayChanges: [], customerOccasions: [],
  operationalConstraints: [], commonlyBoughtTogether: [], isStale: false, staleDays: 0, basisNote: "", ...o,
});
const OPTS = { today: "2026-05-15", maxRecommendations: 30 };
const miniBag: OfferedPackaging = { type: "mini_bag", name: "150g mini", hasCost: true, totalUnitCost: 2, giftingSuitable: false, impulseSuitable: true, premiumScore: null };
const pick = (recs: RetailRecommendation[], id: string) => recs.find((r) => r.playbookId === id);
const growing = (o: Partial<ProductFact> = {}) => P({ name: "Roasted Almonds", growthPct: 12, marginPct: 16.3, revenueSharePct: 8, profitSharePct: 5, ...o });

describe("packaging context unlocks specificity", () => {
  it("mini-bag is BLOCKED when no packaging cost and no offered mini-bag format", () => {
    const r = pick(runRetailReasoning(F([growing()]), OPTS), "growing-margin-below-floor")!;
    expect(r.missingInformation.join(" ")).toMatch(/confirm you offer a mini-bag/i);
  });
  it("mini-bag becomes SPECIFIC once a costed mini-bag format is offered", () => {
    const r = pick(runRetailReasoning(F([growing()], { offeredPackaging: [miniBag] }), OPTS), "growing-margin-below-floor")!;
    expect(r.missingInformation.join(" ")).not.toMatch(/confirm you offer a mini-bag/i);
  });
  it("historical/unknown packaging never breaks reasoning", () => {
    expect(() => runRetailReasoning(F([P({ name: "Loose Nuts", packagingFormat: null })]), OPTS)).not.toThrow();
  });
});

describe("owner category facts change the advice", () => {
  it("do-not-discontinue product is never told to discontinue", () => {
    const r = pick(runRetailReasoning(F([P({ name: "Heritage Mix", onHand: 30, units: 0, daysSold: 0, revenue: 0, grossProfit: 0, doNotDiscontinue: true })]), OPTS), "dead-stock")!;
    expect(r.proposedAction.toLowerCase()).not.toMatch(/review for discontinuation|plan discontinuation/);
    expect(r.contraindications.join(" ")).toMatch(/do-not-discontinue/i);
  });
  it("owner-confirmed traffic driver makes the pricing call a measured conclusion", () => {
    const r = pick(runRetailReasoning(F([P({ name: "Jelly", revenueSharePct: 22, marginPct: 18, velocityPerDay: 9, ownerTrafficDriver: true })]), OPTS), "high-volume-low-margin-traffic")!;
    expect(r.truthLevel).toBe("measured_conclusion");
  });
  it("facings known → an exact add-facing recommendation", () => {
    const r = pick(runRetailReasoning(F([P({ name: "Pecans", profitSharePct: 20, facings: 1 })]), OPTS), "profit-driver-low-space")!;
    expect(r.type).toBe("increase_facings");
  });
});

describe("recommendation quality refinements (Cycle 12)", () => {
  it("caps recommendations per product (no flooding)", () => {
    const recs = runRetailReasoning(F([P({ name: "Pistachios", tier: "premium", marginPct: 18, revenueSharePct: 5, growthPct: 0 })]), { ...OPTS, maxPerProduct: 1 });
    expect(recs.filter((r) => r.affectedProducts[0] === "Pistachios").length).toBeLessThanOrEqual(1);
  });
  it("does not nag a premium product already well-placed", () => {
    const recs = runRetailReasoning(F([P({ name: "Cashews", tier: "premium", displayZone: "premium_block", shelfLevel: "eye" })]), OPTS);
    expect(pick(recs, "premium-weak-presentation")).toBeUndefined();
  });
  it("does not tell a profit driver with ample facings to add more", () => {
    const recs = runRetailReasoning(F([P({ name: "Cashews", profitSharePct: 22, facings: 5 })]), OPTS);
    expect(pick(recs, "profit-driver-low-space")).toBeUndefined();
  });
  it("a growing below-floor product gets the mini-bag, not a duplicate margin-recovery", () => {
    const recs = runRetailReasoning(F([growing()]), OPTS);
    expect(pick(recs, "growing-margin-below-floor")).toBeTruthy();
    expect(pick(recs, "margin-recovery-review")).toBeUndefined();
  });
});

describe("supplier + purchase-timing context playbooks", () => {
  it("quantity-break tier recommended when cover leaves room", () => {
    const r = pick(runRetailReasoning(F([P({ name: "Cashews", daysCover: 20, quantityBreaks: [{ minQty: 50, unitCost: 90 }, { minQty: 100, unitCost: 82 }] })]), OPTS), "supplier-quantity-break")!;
    expect(r.type).toBe("meet_qty_break");
    expect(r.observedFacts.join(" ")).toMatch(/quantity break/i);
  });
  it("non-critical restock is timed to the cheque", () => {
    const r = pick(runRetailReasoning(F([P({ name: "Seeds", isLow: true, profitSharePct: 3 })], { nextChequeEta: "2026-05-25" }), OPTS), "cheque-cycle-purchasing")!;
    expect(r.type).toBe("buy_after_cheque");
    expect(r.timing).toMatch(/2026-05-25/);
  });
});
