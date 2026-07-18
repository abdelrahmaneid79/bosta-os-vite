import { describe, it, expect } from "vitest";
import { runRetailReasoning } from "@/core/strategist/retail/reasoning";
import { KNOWLEDGE_LIBRARY } from "@/core/strategist/retail/knowledge";
import type { ProductFact, RetailBusinessFacts, RetailRecommendation } from "@/core/strategist/retail/contract";

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
  season: null, nextSeason: null, zones: [], observations: [], locationProfile: null, offeredPackaging: [], allowedPromotions: [], allowedDisplayChanges: [], customerOccasions: [],
  operationalConstraints: [], commonlyBoughtTogether: [], isStale: false, staleDays: 0, basisNote: "", ...o,
});
const OPTS = { today: "2026-05-15", maxRecommendations: 40, maxPerProduct: 4 };
const pick = (recs: RetailRecommendation[], id: string) => recs.find((r) => r.playbookId === id);
const run = (f: RetailBusinessFacts) => runRetailReasoning(f, OPTS);

describe("executive knowledge expansion", () => {
  it("library has grown past 30 playbooks with unique ids and full executive metadata on new entries", () => {
    expect(KNOWLEDGE_LIBRARY.length).toBeGreaterThanOrEqual(35);
    const ids = KNOWLEDGE_LIBRARY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pb of KNOWLEDGE_LIBRARY) {
      expect(pb.principle.length).toBeGreaterThan(10);
      expect(pb.requiredEvidence.length).toBeGreaterThan(0);
      expect(pb.testDesign.length).toBeGreaterThan(0);
    }
  });

  it("profit driver below eye level → level swap test", () => {
    const r = pick(run(F([P({ name: "Cashews", profitSharePct: 20, shelfLevel: "low" })])), "eye-level-profit-driver");
    expect(r?.type).toBe("change_shelf_level");
    expect(r?.truthLevel).toBe("experiment_hypothesis");
  });

  it("bought-together pair → adjacency, owner-confirmed basis (strong inference)", () => {
    const r = pick(run(F([P({ name: "Cashews" }), P({ name: "Jelly" })], { commonlyBoughtTogether: [["Cashews", "Jelly"]] })), "adjacency-bought-together");
    expect(r?.type).toBe("improve_adjacency");
    expect(r?.truthLevel).toBe("strong_inference");
    expect(r?.affectedProducts).toEqual(["Cashews", "Jelly"]);
  });

  it("no basket data → no adjacency-bought-together claim", () => {
    expect(pick(run(F([P({ name: "Cashews" })])), "adjacency-bought-together")).toBeUndefined();
  });

  it("gifting occasion + two premiums → gift bundle (blocked without gift pack cost)", () => {
    const r = pick(run(F([P({ name: "Pistachios", tier: "premium" }), P({ name: "Pecans", tier: "premium" })], { customerOccasions: ["Eid gifting"] })), "gift-bundle-occasion");
    expect(r?.type).toBe("bundle_test");
    expect(r?.missingInformation.join(" ")).toMatch(/gift packaging/i);
  });

  it("cost pass-through: margin dropped 6 pts with steady revenue → price review (never on a traffic driver)", () => {
    const r = pick(run(F([P({ name: "Seeds", marginPct: 22, marginDeltaPts: -6, growthPct: 2, revenueSharePct: 5 })])), "cost-passthrough-review");
    expect(r?.type).toBe("review_price");
    expect(r?.truthLevel).toBe("strong_inference");
    const traffic = run(F([P({ name: "Jelly", marginPct: 22, marginDeltaPts: -6, growthPct: 2, revenueSharePct: 5, ownerTrafficDriver: true })]));
    expect(pick(traffic, "cost-passthrough-review")).toBeUndefined();
  });

  it("threshold offer only when the hypermarket permits it", () => {
    const cheap = P({ name: "Gum", avgCost: 5, onHand: 40 });
    expect(pick(run(F([cheap], { allowedPromotions: ["threshold offers"] })), "threshold-offer")?.type).toBe("threshold_offer");
    expect(pick(run(F([cheap])), "threshold-offer")).toBeUndefined();
  });

  it("assortment tail (≥4 under 1%) → grouped review, protected products excluded", () => {
    const tail = ["T1", "T2", "T3", "T4"].map((n) => P({ name: n, revenue: 100, revenueSharePct: 0.5 }));
    const r = pick(run(F(tail)), "assortment-tail");
    expect(r?.truthLevel).toBe("measured_conclusion");
    const protectedTail = tail.map((t) => ({ ...t, doNotDiscontinue: true }));
    expect(pick(run(F(protectedTail)), "assortment-tail")).toBeUndefined();
  });

  it("protected underperformer → reposition, never discontinue", () => {
    const r = pick(run(F([P({ name: "Heritage Mix", doNotDiscontinue: true, profitSharePct: 1, marginPct: 20 })])), "protected-product-improve");
    expect(r?.type).toBe("reposition");
    expect(r?.proposedAction.toLowerCase()).not.toMatch(/discontinu/);
  });

  it("supplier concentration > 60% of inventory value → second-source evidence", () => {
    const products = [1, 2, 3, 4, 5].map((i) => P({ name: `N${i}`, vendor: "BigSupplier", inventoryValue: 5000 }))
      .concat([P({ name: "Other", vendor: "Small", inventoryValue: 1000 })]);
    const r = pick(run(F(products)), "supplier-concentration");
    expect(r?.observedFacts.join(" ")).toMatch(/BigSupplier/);
  });

  it("cover shorter than lead time → order now (measured)", () => {
    const r = pick(run(F([P({ name: "Cashews", daysCover: 3, supplierLeadDays: 7 })])), "lead-time-reorder");
    expect(r?.type).toBe("buy_now");
    expect(r?.truthLevel).toBe("measured_conclusion");
  });

  it("MOQ exceeds affordable cash → buy after cheque / split", () => {
    const r = pick(run(F([P({ name: "Pecans", isLow: true, minOrderQty: 100, avgCost: 90 })], { cashForPurchases: 3000 })), "moq-cash-conflict");
    expect(r?.type).toBe("buy_after_cheque");
    expect(r?.observedFacts.join(" ")).toMatch(/9,000|9000/);
  });

  it("owner-flagged traffic driver low → restock first", () => {
    const r = pick(run(F([P({ name: "Jelly", ownerTrafficDriver: true, isLow: true, profitSharePct: 4 })])), "traffic-driver-availability");
    expect(r).toBeTruthy();
    expect(["buy_now", "count_first"]).toContain(r!.type);
  });

  it("premium with healthy margin but few selling days → sampling trial", () => {
    const r = pick(run(F([P({ name: "Truffle Nuts", tier: "premium", marginPct: 45, daysSold: 6 })])), "sampling-trial");
    expect(r?.type).toBe("smaller_entry_size");
    expect(r?.truthLevel).toBe("experiment_hypothesis");
  });

  it("brand-new product → collect evidence, no premature judgement", () => {
    const r = pick(run(F([P({ name: "New Mix", daysSold: 2, growthPct: null, revenue: 150, revenueSharePct: 0.7 })])), "new-product-evidence");
    expect(r?.type).toBe("collect_evidence");
    expect(r?.truthLevel).toBe("measured_conclusion");
  });

  it("Ramadan season → evening-focus play", () => {
    const r = pick(run(F([P({ name: "Dates" })], { season: "ramadan" })), "ramadan-evening-focus");
    expect(r).toBeTruthy();
    expect(r!.truthLevel).toBe("experiment_hypothesis");
  });

  it("weekend occasion + low profit driver → pre-weekend top-up", () => {
    // profit share 11% clears weekend-readiness (>=10) but not the stockout
    // playbook (>=12), so this isolates the weekend reason
    const r = pick(run(F([P({ name: "Cashews", profitSharePct: 11, daysCover: 2 })], { customerOccasions: ["weekend"] })), "weekend-readiness");
    expect(r?.type).toBe("buy_now");
  });

  it("when two playbooks propose the same buy, the more urgent reason wins the slot", () => {
    // Both weekend-readiness and stockout-risk want "buy Cashews now". That is
    // ONE action, so it is shown once — and running out of an earner outranks
    // the weekend approaching, because it is measured rather than anticipated.
    const recs = run(F([P({ name: "Cashews", profitSharePct: 15, daysCover: 2 })], { customerOccasions: ["weekend"] }));
    const buys = recs.filter((r) => r.type === "buy_now" && r.affectedProducts[0] === "Cashews");
    expect(buys).toHaveLength(1);
    expect(buys[0].playbookId).toBe("stockout-risk-profit-driver");
  });
});
