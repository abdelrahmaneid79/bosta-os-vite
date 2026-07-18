import { describe, it, expect } from "vitest";
import { KNOWLEDGE_LIBRARY } from "@/core/strategist/retail/knowledge";
import type { ProductFact, RetailBusinessFacts } from "@/core/strategist/retail/contract";

/** Regression guard: the repack playbook once proposed a 375g bag of sunflower
 *  seeds because it optimised packaging cost with no regard for box volume or
 *  what a shopper will actually carry to the till. A pack is a purchase
 *  occasion first and a cost calculation second. */

const repack = KNOWLEDGE_LIBRARY.find((k) => k.id === "packaging-tax-repack")!;

const product = (over: Partial<ProductFact>): ProductFact => ({
  id: "p1", name: "Test", category: null, revenue: 10_000, grossProfit: 3_000, marginPct: 30,
  units: 50, cogs: 7_000, daysSold: 60, velocityPerDay: 1, revenueSharePct: 5, profitSharePct: 5,
  growthPct: null, marginDeltaPts: null, onHand: null, inventoryValue: null, inventorySharePct: null,
  daysCover: null, sellingPrice: 200, avgCost: 110, hasCost: true, isLow: false, vendor: null,
  packagingFormat: "Small clamshell (SH1A)", packSizeG: 150, packagingCost: 3.956,
  displayZone: null, shelfLevel: null, facings: null, tier: null, impulseType: null,
  minOrderQty: null, supplierLeadDays: null, quantityBreaks: null,
  doNotDiscontinue: false, ownerTrafficDriver: false,
  ...over,
});

const facts = (): RetailBusinessFacts => ({
  period: "Jun 2026", comparePeriod: "May 2026", products: [], totalRevenue: 87_000,
  totalGrossProfit: 35_000, coveragePct: 100, inventoryTracked: false, stockCountAgeDays: null,
  cashCountFresh: false, marginFloorPct: 30, maxCoverDays: null, deadStockDays: null,
  strategicProducts: [], cashForPurchases: null, nextChequeEta: null, season: null, nextSeason: null, zones: [], observations: [], locationProfile: null,
  offeredPackaging: [], allowedPromotions: [], allowedDisplayChanges: [], customerOccasions: [],
  operationalConstraints: [], commonlyBoughtTogether: [], isStale: false, staleDays: null,
  basisNote: "test",
});

describe("packaging-tax-repack sizing sanity", () => {
  it("proposes a box-step (~2x), never an invented multiplier", () => {
    // Syrian Seeds: 153g at 200/kg -> ~31 EGP pack
    const p = product({ name: "Syrian Seeds", packSizeG: 153, sellingPrice: 200, avgCost: 109.25 });
    expect(repack.match!(p, facts())).toBe(true);
    const d = repack.build!(p, facts())!;
    // ~305g (a full 500cc box at this density), NOT the 375g the old code produced
    expect(d.proposedAction).toContain("305g");
    expect(d.proposedAction).not.toContain("375");
  });

  it("keeps the small pack rather than replacing it", () => {
    const p = product({ name: "Syrian Seeds", packSizeG: 153, sellingPrice: 200, avgCost: 109.25 });
    const d = repack.build!(p, facts())!;
    expect(d.proposedAction.toLowerCase()).toContain("keep the current");
    expect(d.title.toLowerCase()).toContain("add a larger");
  });

  it("never pushes a pack past the take-home price band", () => {
    // a pack already at ~70 EGP would double to ~140 — too much to be an everyday snack
    const p = product({ name: "Pricey line", packSizeG: 300, sellingPrice: 233, avgCost: 120 });
    expect(repack.match!(p, facts())).toBe(false);
  });

  it("ignores premium nuts, where packaging is a rounding error", () => {
    const p = product({ name: "Pistachios", packSizeG: 122.5, sellingPrice: 1100, avgCost: 833.75 });
    expect(repack.match!(p, facts())).toBe(false);
  });

  it("does not fire without a recorded pack weight — asks rather than guesses", () => {
    const p = product({ name: "Unknown", packSizeG: null });
    expect(repack.match!(p, facts())).toBe(false);
  });
});
