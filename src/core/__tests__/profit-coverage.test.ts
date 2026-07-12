/** Coverage-aware profit contract — the "hides, never lies" rules:
 *  header-only days (revenue with no product lines) must be quantified as
 *  uncovered exposure, margins must use the covered denominator, and the
 *  cash-accuracy score must never flatter when the expected balance ≤ 0. */
import { describe, expect, it } from "vitest";
import { composeProfit } from "@/core/read/profit";
import { scoreCashAccuracy } from "@/core/read/health";

describe("composeProfit coverage", () => {
  it("mixed month: header-only days are exposure, margin uses covered revenue only", () => {
    // 20 total-only days (80k) + 10 fully-costed detail days (40k rev, 25k COGS)
    const p = composeProfit({ revenue: 120_000, cogs: 25_000, operatingExpenses: 10_000, soldLines: 200, missingCostLines: 0, coveredRevenue: 40_000 });
    expect(p.uncoveredRevenue).toBe(80_000);
    expect(p.coveredPct).toBeCloseTo(33.33, 1);
    expect(p.margin).toBeCloseTo(37.5, 5); // (40k − 25k) / 40k — NOT the flattering 79% on 120k
    expect(p.grossProfit).toBeNull();      // whole-range profit unknowable
    expect(p.netProfit).toBeNull();
    expect(p.complete).toBe(false);
  });

  it("fully covered month with all costs → complete, real gross/net", () => {
    const p = composeProfit({ revenue: 50_000, cogs: 30_000, operatingExpenses: 5_000, soldLines: 120, missingCostLines: 0, coveredRevenue: 50_000 });
    expect(p.complete).toBe(true);
    expect(p.grossProfit).toBe(20_000);
    expect(p.netProfit).toBe(15_000);
    expect(p.margin).toBeCloseTo(40, 5);
    expect(p.uncoveredRevenue).toBe(0);
  });

  it("covered but lines missing cost → margin withheld, never guessed", () => {
    const p = composeProfit({ revenue: 50_000, cogs: 22_000, operatingExpenses: 5_000, soldLines: 120, missingCostLines: 3, coveredRevenue: 50_000 });
    expect(p.margin).toBeNull();
    expect(p.grossProfit).toBeNull();
    expect(p.complete).toBe(false);
  });

  it("all-header-only month → nothing scoreable, full exposure", () => {
    const p = composeProfit({ revenue: 90_000, cogs: 0, operatingExpenses: 8_000, soldLines: 0, missingCostLines: 0, coveredRevenue: 0 });
    expect(p.margin).toBeNull();
    expect(p.grossProfit).toBeNull();
    expect(p.uncoveredRevenue).toBe(90_000);
    expect(p.coveredPct).toBe(0);
    expect(p.complete).toBe(false);
  });

  it("back-compat: callers without coverage data treat revenue as covered", () => {
    const p = composeProfit({ revenue: 10_000, cogs: 6_000, operatingExpenses: 1_000, soldLines: 30, missingCostLines: 0 });
    expect(p.complete).toBe(true);
    expect(p.grossProfit).toBe(4_000);
    expect(p.uncoveredRevenue).toBe(0);
  });
});

describe("scoreCashAccuracy", () => {
  it("never flatters when expected ≤ 0", () => {
    const s = scoreCashAccuracy(-200, 5_000); // old formula scored this 100
    expect(s.errPct).toBeGreaterThan(50);
    expect(s.score).toBe(0);
  });
  it("expected 0, counted 0 → perfectly accurate", () => {
    const s = scoreCashAccuracy(0, 0);
    expect(s.errPct).toBe(0);
    expect(s.score).toBe(100);
  });
  it("small drift scores proportionally", () => {
    const s = scoreCashAccuracy(1_000, 990);
    expect(s.errPct).toBeCloseTo(1, 5);
    expect(s.score).toBe(96);
  });
});
