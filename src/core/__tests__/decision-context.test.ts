/** Deterministic decision context — scenario numbers the LLM must use verbatim. */
import { describe, expect, it } from "vitest";
import { computeDecisionContext } from "@/core/strategist/analysis/decision";
import { missing, metric } from "@/core/strategist/contract";
import { makeSnapshot } from "@/core/strategist/analysis/fixture";

describe("computeDecisionContext", () => {
  it("computes headroom, withdrawal guideline and margin-point value from the snapshot", () => {
    const s = makeSnapshot();
    const d = computeDecisionContext(s);
    expect(d.cashHeadroomAboveFloor).toBe(60_000 - 25_000);
    expect(d.withdrawalGuidelineMax).toBe(13_500);        // 50% of 27k net profit
    expect(d.marginPointValue).toBe(1_100);               // covered 110k / 100
    expect(d.reserveFloor).toBe(25_000);
  });

  it("cash untracked → headroom null with a caveat, never zero", () => {
    const s = makeSnapshot({ cash: { hasLiveData: false, expectedBalance: missing("t", "p", "/money", "no data") } });
    const d = computeDecisionContext(s);
    expect(d.cashHeadroomAboveFloor).toBeNull();
    expect(d.caveats.join(" ")).toContain("cash is not tracked");
  });

  it("profit withheld → withdrawal guideline null with a caveat", () => {
    const s = makeSnapshot({ profit: { netProfit: missing("t", "p", "/reconcile", "withheld") } });
    const d = computeDecisionContext(s);
    expect(d.withdrawalGuidelineMax).toBeNull();
    expect(d.monthlyNetProfit).toBeNull();
    expect(d.caveats.join(" ")).toContain("net profit is withheld");
  });

  it("lists products below the owner's margin floor as repricing candidates", () => {
    const s = makeSnapshot({
      products: {
        topRevenue: metric([
          { name: "سوداني", revenue: 30_000, units: 400, grossProfit: 5_400, marginPct: 18, missingCost: false },
          { name: "كاجو", revenue: 22_000, units: 90, grossProfit: 11_000, marginPct: 50, missingCost: false },
        ], "test", "p", "/reports", { confidence: "high" }),
      },
    });
    const d = computeDecisionContext(s);
    expect(d.belowMarginFloor).toHaveLength(1);
    expect(d.belowMarginFloor[0].name).toBe("سوداني");
  });
});
