import { describe, it, expect } from "vitest";
import {
  trueEconomics, breakEven, revenueForProfit, repackSaving, packWeightForPrice,
  type StoreCostModel,
} from "@/core/strategist/retail/unit-economics";

/** Gardenia's real cost model: 3% mall commission, 3.25 box + 0.706 sticker,
 *  15,000 rent + ~10,000 salary/accountant. */
const GARDENIA: StoreCostModel = {
  commissionPct: 0.03,
  packagingCostPerPack: 3.956,
  fixedMonthly: 25_000,
};

describe("trueEconomics", () => {
  it("shows packaging barely touching a premium nut", () => {
    // Pistachios: 1100/kg, cost 833.75, ~122.5g packs
    const e = trueEconomics({ name: "Pistachios", pricePerKg: 1100, costPerKg: 833.75, packSizeG: 122.5 }, GARDENIA);
    expect(e.grossMarginPct).toBeCloseTo(24.2, 0);
    expect(e.trueMarginPct).toBeCloseTo(18.3, 0);
    // on a ~135 EGP pack the box is a rounding error
    expect(e.packagingPctOfTicket!).toBeLessThan(3.5);
  });

  it("shows packaging savaging a cheap line", () => {
    // Kabuki peanuts: 225/kg, cost 150, ~172.5g packs
    const e = trueEconomics({ name: "Kabuki Peanuts", pricePerKg: 225, costPerKg: 150, packSizeG: 172.5 }, GARDENIA);
    expect(e.grossMarginPct).toBeCloseTo(33.3, 0);
    // a third of the gross margin is gone
    expect(e.trueMarginPct!).toBeLessThan(22);
    expect(e.packagingPctOfTicket!).toBeGreaterThan(9);
  });

  it("proves the packaging tax is inverted vs price", () => {
    const cheap = trueEconomics({ name: "cheap", pricePerKg: 225, costPerKg: 150, packSizeG: 172.5 }, GARDENIA);
    const premium = trueEconomics({ name: "premium", pricePerKg: 1100, costPerKg: 833.75, packSizeG: 122.5 }, GARDENIA);
    // the SAME box costs the cheap line several times more of its ticket
    expect(cheap.packagingPctOfTicket!).toBeGreaterThan(premium.packagingPctOfTicket! * 2.5);
  });

  it("flags a product priced below a same-cost sibling", () => {
    // Raw Cashews and Cashews cost the same 718.75 but are priced 820 vs 950
    const raw = trueEconomics({ name: "Raw Cashews", pricePerKg: 820, costPerKg: 718.75, packSizeG: 133.8 }, GARDENIA);
    const roasted = trueEconomics({ name: "Cashews", pricePerKg: 950, costPerKg: 718.75, packSizeG: 133.8 }, GARDENIA);
    expect(raw.trueMarginPct!).toBeLessThan(10);
    expect(roasted.trueMarginPct!).toBeGreaterThan(raw.trueMarginPct! + 8);
  });

  it("reports gross margin only when pack size is unknown — never guesses a fill weight", () => {
    const e = trueEconomics({ name: "Unknown", pricePerKg: 300, costPerKg: 150, packSizeG: null }, GARDENIA);
    expect(e.grossMarginPct).toBe(50);
    expect(e.trueMarginPct).toBeNull();
    expect(e.packagingPerKg).toBeNull();
  });

  it("returns nulls rather than nonsense for missing price/cost", () => {
    const e = trueEconomics({ name: "x", pricePerKg: null, costPerKg: 10, packSizeG: 150 }, GARDENIA);
    expect(e.grossMarginPct).toBeNull();
    expect(e.trueMarginPct).toBeNull();
  });
});

describe("breakEven", () => {
  it("reproduces June 2026 — barely above water", () => {
    const r = breakEven(86_909, 25_889, 25_000);
    expect(r.contributionMarginPct).toBeCloseTo(29.8, 0);
    expect(r.profit).toBe(889);
    expect(r.breakEvenRevenue).toBeGreaterThan(83_000);
    expect(r.status).toBe("thin");
  });

  it("reproduces December 2025 — a healthy month", () => {
    const r = breakEven(200_620, 59_057, 25_000);
    expect(r.profit).toBe(34_057);
    expect(r.status).toBe("healthy");
    expect(r.marginOfSafetyPct).toBeGreaterThan(100);
  });

  it("flags a loss-making month", () => {
    const r = breakEven(60_000, 18_000, 25_000);
    expect(r.profit).toBeLessThan(0);
    expect(r.status).toBe("below");
  });

  it("exposes the operating leverage that makes revenue dips brutal", () => {
    const good = breakEven(200_620, 59_057, 25_000);
    const bad = breakEven(86_909, 25_889, 25_000);
    const revenueDrop = 1 - bad.revenue / good.revenue;   // ~57%
    const profitDrop = 1 - bad.profit / good.profit;      // ~97%
    expect(profitDrop).toBeGreaterThan(revenueDrop * 1.5);
  });

  it("quantifies what each extra 1,000 of revenue is worth", () => {
    const r = breakEven(86_909, 25_889, 25_000);
    expect(r.profitPer1000Revenue).toBeGreaterThan(250);
  });
});

describe("revenueForProfit", () => {
  it("answers 'what must I sell to make 15k?'", () => {
    expect(revenueForProfit(15_000, 29.8, 25_000)).toBe(134_228);
  });
  it("returns null when contribution margin is zero or negative", () => {
    expect(revenueForProfit(10_000, 0, 25_000)).toBeNull();
  });
});

describe("repackSaving", () => {
  it("prices the gain from fewer, larger packs", () => {
    // 47.7kg of salted peanuts at 181g vs 317g packs
    const r = repackSaving(47.7, 181, 317, 3.956)!;
    expect(r.currentPacks).toBe(264);
    expect(r.targetPacks).toBe(150);
    expect(r.packsSaved).toBe(114);
    expect(r.saving).toBeGreaterThan(400);
  });

  it("refuses to 'save' by shrinking the pack", () => {
    expect(repackSaving(50, 300, 150, 3.956)).toBeNull();
  });
});

describe("packWeightForPrice", () => {
  it("finds the fill weight that lands a round price", () => {
    // salted peanuts at 236.50/kg -> 75 EGP
    expect(packWeightForPrice(236.5, 75)).toBe(317);
    // chocolate peanuts at 275/kg -> 100 EGP
    expect(packWeightForPrice(275, 100)).toBe(364);
  });
});
