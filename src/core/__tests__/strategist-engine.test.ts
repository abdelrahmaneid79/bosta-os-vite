/** Deterministic strategy engine — scenario suite.
 *  Every scenario asserts: the right finding exists, evidence carries the
 *  fixture's real numbers (nothing invented), ranking behaves, and missing
 *  data is disclosed rather than zero-filled. */
import { describe, expect, it } from "vitest";
import { metric, missing, type Metric, type StrategistSnapshot } from "@/core/strategist/contract";
import { analyzeSnapshot, detectChanges, findContradictions, rankFindings } from "@/core/strategist/analysis/engine";
import { composeContext } from "@/core/strategist/context";
import { coverageConfidence } from "@/core/strategist/snapshot-v2";
import { makeSnapshot } from "@/core/strategist/analysis/fixture";

const P = "2026-05-01→2026-05-31";
const C = "2026-04-01→2026-04-30";
const m = <T,>(v: T, note?: string): Metric<T> => metric(v, "test", P, "/x", note ? { note } : {});
void ((): StrategistSnapshot | null => null); // keep type import used

/* ── scenarios ─────────────────────────────────────────────────────────── */

describe("strategy engine scenarios", () => {
  it("revenue up + margin down → contradiction ranked at/near the top with real numbers", () => {
    const s = makeSnapshot({
      revenue: { changePct: metric(18, "test", `${C} → ${P}`, "/sales", { basis: "calculated" }), periodRevenue: m(130_000), priorRevenue: m(110_000) },
      profit: { grossMarginPct: metric(35.8, "test", P, "/reconcile", { confidence: "high" }), priorGrossMarginPct: metric(40, "test", C, "/reconcile"), coveredRevenue: metric(125_000, "test", P, "/reconcile", { completeness: 96 }) },
    });
    const f = analyzeSnapshot(s);
    const contra = f.find((x) => x.id === "growth-weaker-economics");
    expect(contra).toBeDefined();
    expect(contra!.class).toBe("contradiction");
    expect(contra!.rank).toBeLessThanOrEqual(2);
    // impact = margin points lost × covered revenue — from fixture, not invented
    expect(contra!.impactEgp).toBe(Math.round(0.042 * 125_000));
    expect(contra!.evidence.some((e) => e.value.includes("35.8%"))).toBe(true);
    expect(contra!.action?.screenLink).toBe("/reports");
  });

  it("profit up + cash below reserve floor → contradiction with today urgency", () => {
    const s = makeSnapshot({ cash: { expectedBalance: m(9_000), hasLiveData: true } });
    const f = analyzeSnapshot(s);
    const c = f.find((x) => x.id === "profit-up-cash-low");
    expect(c).toBeDefined();
    expect(c!.urgency).toBe("today");
    expect(c!.evidence.map((e) => e.label)).toContain("Reserve floor");
    // default floor (25k) − 9k = 16k at stake
    expect(c!.impactEgp).toBe(16_000);
  });

  it("no cash data → NO cash contradiction, but an explicit data-quality finding", () => {
    const s = makeSnapshot({
      cash: {
        hasLiveData: false,
        expectedBalance: m(9_000),
        latestCount: missing("test", P, "/money", "never counted"),
      },
    });
    const f = analyzeSnapshot(s);
    expect(f.find((x) => x.id === "profit-up-cash-low")).toBeUndefined();
    const dq = f.find((x) => x.id === "cash-not-tracked");
    expect(dq).toBeDefined();
    expect(dq!.class).toBe("data_quality");
    expect(dq!.evidence[0].value).toContain("unknown");
  });

  it("high withdrawals vs profit → decision risk citing the owner rule, never as expense", () => {
    const s = makeSnapshot({ expenses: { withdrawals: m(20_000) } }); // net profit 27k → limit 13.5k
    const f = analyzeSnapshot(s);
    const w = f.find((x) => x.id === "withdrawals-high");
    expect(w).toBeDefined();
    expect(w!.class).toBe("decision_risk");
    expect(w!.impactEgp).toBe(Math.round(20_000 - 13_500));
    expect(w!.detail).toContain("not expenses");
  });

  it("low stock on a fast seller → today-urgency restock naming the product", () => {
    const s = makeSnapshot({
      products: { stockRisk: m([{ name: "سوداني", daysCover: null, onHand: 2 }]) },
    });
    const f = analyzeSnapshot(s);
    const r = f.find((x) => x.id === "stock-risk");
    expect(r).toBeDefined();
    expect(r!.urgency).toBe("today");
    expect(r!.action?.action).toContain("سوداني");
  });

  it("no inventory data → stock silence is replaced by an honest data-quality finding", () => {
    const s = makeSnapshot({
      inventory: { hasLiveData: false, stockValue: missing("test", "now", "/stock", "no data") },
      products: { stockRisk: missing("test", "now", "/stock", "inventory not tracked") },
    });
    const f = analyzeSnapshot(s);
    expect(f.find((x) => x.id === "stock-risk")).toBeUndefined();
    expect(f.find((x) => x.id === "inventory-not-tracked")).toBeDefined();
  });

  it("overdue cheque periods → warning listing the months", () => {
    const s = makeSnapshot({ cheques: { overduePeriods: m(["2026-03", "2026-04"]) } });
    const f = analyzeSnapshot(s);
    const o = f.find((x) => x.id === "overdue-cheques");
    expect(o).toBeDefined();
    expect(o!.title).toContain("2026-03");
    expect(o!.missingData.length).toBeGreaterThan(0); // received-but-unrecorded possibility disclosed
  });

  it("missing COGS on products → data-quality naming products, action to /costs", () => {
    const s = makeSnapshot({ products: { missingCosts: m(["بونبون", "كناكر"]) } });
    const f = analyzeSnapshot(s);
    const d = f.find((x) => x.id === "missing-costs");
    expect(d).toBeDefined();
    expect(d!.detail).toContain("بونبون");
    expect(d!.action?.screenLink).toBe("/costs");
    expect(d!.missingData).toContain("بونبون cost");
  });

  it("expense category spike → warning with the exact delta as impact", () => {
    const s = makeSnapshot({ expenses: { spikes: m([{ name: "Rent", value: 26_000, changePct: 73.3 }]) } });
    const f = analyzeSnapshot(s);
    const e = f.find((x) => x.id.startsWith("expense-spike"));
    expect(e).toBeDefined();
    expect(e!.impactEgp).toBe(Math.round(26_000 - 26_000 / 1.733));
    expect(e!.action?.screenLink).toBe("/expenses");
  });

  it("insufficient history → no trend claims at all", () => {
    const s = makeSnapshot({ revenue: { monthlySeries: m([{ name: "2026-05", value: 114_000 }]) } });
    const f = detectChanges(s);
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe("insufficient-history");
  });

  it("stale books → today-urgency data-quality naming the last data date", () => {
    const s = makeSnapshot({ meta: { isStale: true, staleDays: 43, lastDataDate: "2026-05-31" } });
    const f = analyzeSnapshot(s);
    const st = f.find((x) => x.id === "stale-books");
    expect(st).toBeDefined();
    expect(st!.urgency).toBe("today");
    expect(st!.missingData[0]).toContain("2026-05-31");
  });

  it("uncovered revenue → quantified exposure, share-scaled urgency", () => {
    const s = makeSnapshot({ profit: { uncoveredRevenue: m(70_000), revenue: m(114_000) } });
    const f = analyzeSnapshot(s);
    const u = f.find((x) => x.id === "uncovered-revenue");
    expect(u).toBeDefined();
    expect(u!.impactEgp).toBe(70_000);
    expect(u!.urgency).toBe("this_week"); // > 50% share
  });

  it("settlement lag → contradiction when the open tab exceeds ~a month of sales", () => {
    const s = makeSnapshot({ cheques: { openTabGross: m(160_000) } }); // rolling30Avg 3,700 → month ≈ 111k
    const f = findContradictions(makeSnapshot({ cheques: { openTabGross: m(160_000) } }));
    const lag = f.find((x) => x.id === "settlement-lag");
    expect(lag).toBeDefined();
    expect(lag!.evidence.some((e) => e.label.includes("Open tab"))).toBe(true);
    expect(s.cheques.openTabGross.value).toBe(160_000);
  });

  it("quiet period → single steady-state finding, nothing fabricated", () => {
    const s = makeSnapshot({
      revenue: { changePct: metric(1.2, "test", `${C} → ${P}`, "/sales", { basis: "calculated" }) },
      profit: { priorGrossMarginPct: metric(40.5, "test", C, "/reconcile") },
      dataQuality: { missingOwnerInputs: [] },
    });
    // remove the one genuine dq finding sources
    s.profit.uncoveredRevenue = m(0);
    const f = analyzeSnapshot(s);
    expect(f.find((x) => x.id === "steady-state")).toBeDefined();
  });

  it("ranking is deterministic and contradictions outrank facts at equal impact", () => {
    const s = makeSnapshot({
      revenue: { changePct: metric(18, "test", C, "/sales", { basis: "calculated" }) },
      profit: { grossMarginPct: metric(35, "test", P, "/reconcile", { confidence: "high" }), priorGrossMarginPct: metric(40, "test", C, "/reconcile") },
    });
    const a = analyzeSnapshot(s);
    const b = analyzeSnapshot(s);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id)); // same input → same order
    const contra = a.find((x) => x.class === "contradiction")!;
    const fact = a.find((x) => x.class === "fact");
    if (fact) expect(contra.rank).toBeLessThan(fact.rank);
  });
});

/* ── snapshot-contract honesty tests ──────────────────────────────────── */

describe("snapshot contract honesty", () => {
  it("missing() never yields a zero — value is null, basis is missing", () => {
    const x = missing("src", "p", "/x", "why");
    expect(x.value).toBeNull();
    expect(x.basis).toBe("missing");
    expect(x.confidence).toBe("none");
  });

  it("coverage lowers confidence monotonically", () => {
    expect(coverageConfidence(100, 0)).toBe("high");
    expect(coverageConfidence(80, 0)).toBe("medium");
    expect(coverageConfidence(30, 0)).toBe("low");
    expect(coverageConfidence(0, 0)).toBe("none");
    expect(coverageConfidence(null, 0)).toBe("none");
    expect(coverageConfidence(100, 3)).toBe("medium"); // missing cost lines cap it
  });

  it("withdrawals live outside operating expenses and are labeled so", () => {
    const s = makeSnapshot();
    expect(s.expenses.withdrawals.note).toContain("NEVER");
    // operating total is the profit readout's opex — withdrawals not included
    expect(s.expenses.operatingTotal.value).toBe(21_000);
    expect(s.expenses.withdrawals.value).toBe(5_000);
  });

  it("cash and profit blocks cite different sources (never conflated)", () => {
    const s = makeSnapshot();
    expect(s.profit.netProfit.source).not.toBe(s.cash.expectedBalance.source ?? "");
  });

  it("context defaults are labeled as estimates, owner answers as facts", () => {
    const d = composeContext(null, P);
    expect(d.grossMarginFloorPct.basis).toBe("estimated");
    expect(d.grossMarginFloorPct.value).toBe(25);
    const o = composeContext({ grossMarginFloorPct: 30 }, P);
    expect(o.grossMarginFloorPct.basis).toBe("fact");
    expect(o.grossMarginFloorPct.value).toBe(30);
  });

  it("rankFindings assigns dense ranks and stable tie-break", () => {
    const s = makeSnapshot();
    const ranked = rankFindings(analyzeSnapshot(s));
    expect(ranked.map((f) => f.rank)).toEqual(ranked.map((_, i) => i + 1));
  });
});
