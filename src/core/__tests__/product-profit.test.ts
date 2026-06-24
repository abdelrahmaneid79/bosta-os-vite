import { describe, it, expect } from "vitest";
import { composeLifetimeProfit, profitConfidence, effectiveCost } from "@/core/products/profit";

describe("effectiveCost (roasting + packaging uplift)", () => {
  it("upweights estimate (raw nut) costs", () => {
    expect(effectiveCost(100, "estimate", 15)).toBe(115);
  });
  it("leaves verified resale costs unchanged", () => {
    expect(effectiveCost(100, "verified", 15)).toBe(100);
  });
  it("returns null for unknown / non-positive cost", () => {
    expect(effectiveCost(null, "unknown", 15)).toBeNull();
    expect(effectiveCost(0, "verified", 15)).toBeNull();
  });
  it("0% uplift is a no-op", () => {
    expect(effectiveCost(200, "estimate", 0)).toBe(200);
  });
});

describe("composeLifetimeProfit", () => {
  it("computes cogs / gross profit / margin from a known cost", () => {
    const r = composeLifetimeProfit(1000, 10, 60, "verified");
    expect(r.cogs).toBe(600);
    expect(r.grossProfit).toBe(400);
    expect(r.margin).toBe(40);
    expect(r.costSource).toBe("verified");
  });
  it("keeps the estimate flag through the calc", () => {
    expect(composeLifetimeProfit(1000, 1, 600, "estimate").costSource).toBe("estimate");
  });
  it("withholds profit (null) when cost is unknown — never guesses", () => {
    const r = composeLifetimeProfit(1000, 10, null, "unknown");
    expect(r).toEqual({ cogs: null, grossProfit: null, margin: null, costSource: "unknown" });
  });
  it("treats a zero/negative cost as unknown", () => {
    expect(composeLifetimeProfit(1000, 10, 0, "verified").grossProfit).toBeNull();
  });
});

describe("profitConfidence", () => {
  it("is high when most revenue is verified", () => {
    const c = profitConfidence([{ revenue: 900, costSource: "verified" }, { revenue: 100, costSource: "unknown" }]);
    expect(c.label).toBe("high");
    expect(c.pct).toBe(90);
  });
  it("discounts estimate-costed revenue", () => {
    const c = profitConfidence([{ revenue: 1000, costSource: "estimate" }]);
    expect(c.pct).toBe(70);
    expect(c.label).toBe("good");
  });
  it("is low when little revenue has a cost", () => {
    expect(profitConfidence([{ revenue: 1000, costSource: "unknown" }]).label).toBe("low");
  });
});
