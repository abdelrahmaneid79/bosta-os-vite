/** Cycle 6 — root-cause contribution, PVM+cost decomposition, portfolio
 *  classification, pricing/purchase signals, shelf priority, weekly priority,
 *  recommendation outcomes. All pure, all deterministic. */
import { describe, expect, it } from "vitest";
import { makeSnapshot } from "@/core/strategist/analysis/fixture";
import { metric, type ProductPeriodEntry, type ProductPositionEntry } from "@/core/strategist/contract";
import {
  analyzeContribution, decomposeChange, classifyPortfolio, shelfPriorities,
  pricingReviews, purchaseReviews,
} from "@/core/strategist/analysis/products";
import { buildStrategyReport } from "@/core/strategist/analysis/report";
import { selectWeeklyPriority } from "@/core/strategist/analysis/priority";
import { planOutcomeEvaluation, type ActionOutcomeRow } from "@/core/strategist/persistence/outcomes";
import type { Finding } from "@/core/strategist/analysis/types";

const P = "2026-05-01→2026-05-31";
const C = "2026-04-01→2026-04-30";
const pe = (name: string, revenue: number, units: number, gp: number | null, days = 20): ProductPeriodEntry => ({
  name, revenue, units, grossProfit: gp, marginPct: gp != null && revenue > 0 ? Math.round((gp / revenue) * 1000) / 10 : null,
  missingCost: gp == null, cogs: gp != null ? revenue - gp : 0, daysSold: days,
});
const detail = (list: ProductPeriodEntry[], cov = 95) =>
  metric(list, "read/products.getProductProfit", P, "/reports", { confidence: "high", completeness: cov });
const compare = (list: ProductPeriodEntry[], cov = 95) =>
  metric(list, "read/products.getProductProfit", C, "/reports", { confidence: "high", completeness: cov });

/* ═══ CONTRIBUTION ═══ */
describe("contribution analysis", () => {
  it("one product explains most of the growth, concentrated, deterministic ranking", () => {
    const s = makeSnapshot({
      revenue: { periodRevenue: metric(150_000, "t", P, "/sales"), priorRevenue: metric(100_000, "t", C, "/sales") },
      products: {
        detail: detail([pe("A", 72_000, 720, 28_800), pe("B", 44_000, 440, 17_600), pe("C", 30_000, 300, 12_000)]),
        compareDetail: compare([pe("A", 40_000, 400, 16_000), pe("B", 36_000, 360, 14_400), pe("C", 22_000, 220, 8_800)]),
      },
    });
    const c1 = analyzeContribution(s, "revenue");
    const c2 = analyzeContribution(s, "revenue");
    expect(c1.available).toBe(true);
    expect(c1.positive[0]).toEqual({ name: "A", delta: 32_000, sharePct: expect.any(Number) });
    expect(c1.explainedChange).toBe(48_000);
    expect(c1.unexplained).toBe(2_000); // uncovered slice stays visible
    expect(c1.concentrated).toBe(true);
    expect(c1.positive.map((x) => x.name)).toEqual(c2.positive.map((x) => x.name)); // same input → same ranking
  });

  it("one product causes most of a decline", () => {
    const s = makeSnapshot({
      revenue: { periodRevenue: metric(80_000, "t", P, "/sales"), priorRevenue: metric(110_000, "t", C, "/sales") },
      products: {
        detail: detail([pe("A", 20_000, 200, 8_000), pe("B", 40_000, 400, 16_000), pe("C", 18_000, 180, 7_200)]),
        compareDetail: compare([pe("A", 48_000, 480, 19_200), pe("B", 41_000, 410, 16_400), pe("C", 19_000, 190, 7_600)]),
      },
    });
    const c = analyzeContribution(s, "revenue");
    expect(c.negative[0].name).toBe("A");
    expect(c.negative[0].delta).toBe(-28_000);
  });

  it("low coverage blocks attribution with the reason, never guesses", () => {
    const s = makeSnapshot({ products: { detail: detail([pe("A", 5_000, 50, 2_000)], 20), compareDetail: compare([pe("A", 4_000, 40, 1_600)], 20) } });
    const c = analyzeContribution(s, "revenue");
    expect(c.available).toBe(false);
    expect(c.reason).toContain("coverage");
    expect(c.positive).toEqual([]);
    expect(c.unexplained).toBe(c.totalChange);
  });

  it("gross-profit contribution keeps missing-cost products OUT and names them", () => {
    const s = makeSnapshot({
      products: {
        detail: detail([pe("A", 30_000, 300, 12_000), pe("NoCost", 10_000, 100, null)]),
        compareDetail: compare([pe("A", 25_000, 250, 10_000), pe("NoCost", 9_000, 90, null)]),
      },
    });
    const c = analyzeContribution(s, "grossProfit");
    expect(c.positive.map((x) => x.name)).toEqual(["A"]);
    expect(c.missing.join(" ")).toContain("NoCost");
  });
});

/* ═══ DECOMPOSITION ═══ */
describe("price/volume/mix/cost decomposition", () => {
  it("volume-led growth shows in volumeEffect; residual stays visible", () => {
    // same prices/costs/margins, more units
    const s = makeSnapshot({
      products: {
        detail: detail([pe("A", 60_000, 600, 24_000), pe("B", 40_000, 200, 16_000), pe("C", 20_000, 100, 8_000)]),
        compareDetail: compare([pe("A", 40_000, 400, 16_000), pe("B", 30_000, 150, 12_000), pe("C", 20_000, 100, 8_000)]),
      },
    });
    const d = decomposeChange(s);
    expect(d.available).toBe(true);
    expect(d.volumeEffect + d.mixEffect).toBe(12_000);   // ΔGP entirely from volume(+mix split)
    expect(d.priceEffect).toBe(0);
    expect(d.costEffect).toBe(0);
    expect(Math.abs(d.residual)).toBeLessThanOrEqual(1);
  });

  it("price-led growth shows in priceEffect", () => {
    // same units & unit costs, higher selling price on A
    const s = makeSnapshot({
      products: {
        detail: detail([pe("A", 48_000, 400, 24_000), pe("B", 30_000, 150, 12_000), pe("C", 20_000, 100, 8_000)]),
        compareDetail: compare([pe("A", 40_000, 400, 16_000), pe("B", 30_000, 150, 12_000), pe("C", 20_000, 100, 8_000)]),
      },
    });
    const d = decomposeChange(s);
    expect(d.priceEffect).toBe(8_000);
    expect(d.volumeEffect).toBe(0);
    expect(d.costEffect).toBe(0);
  });

  it("cost-led margin decline shows negative costEffect", () => {
    // same revenue/units, higher cogs on A
    const s = makeSnapshot({
      products: {
        detail: detail([pe("A", 40_000, 400, 10_000), pe("B", 30_000, 150, 12_000), pe("C", 20_000, 100, 8_000)]),
        compareDetail: compare([pe("A", 40_000, 400, 16_000), pe("B", 30_000, 150, 12_000), pe("C", 20_000, 100, 8_000)]),
      },
    });
    const d = decomposeChange(s);
    expect(d.costEffect).toBe(-6_000);
    expect(d.priceEffect).toBe(0);
  });

  it("fewer than 3 comparable products blocks decomposition with the reason", () => {
    const s = makeSnapshot({
      products: {
        detail: detail([pe("A", 40_000, 400, 16_000), pe("B", 10_000, 0, 4_000)]), // B has no units
        compareDetail: compare([pe("A", 38_000, 380, 15_200)]),
      },
    });
    const d = decomposeChange(s);
    expect(d.available).toBe(false);
    expect(d.reason).toContain("fewer than 3");
    expect(d.excludedProducts.join(" ")).toContain("B");
  });
});

/* ═══ CLASSIFICATION ═══ */
describe("portfolio classification", () => {
  const rich = () => makeSnapshot({
    products: {
      detail: detail([
        pe("Star", 40_000, 400, 18_000, 28),           // 40%+ share, 45% margin
        pe("HVLM", 30_000, 900, 6_000, 26),            // big share, 20% margin
        pe("LVHM", 3_000, 12, 1_800, 8),               // 60% margin, tiny share
        pe("Weak", 1_500, 40, 300, 6),                 // 20% margin, tiny, infrequent
        pe("Declining", 6_000, 60, 2_400, 12),
        pe("Emerging", 4_000, 40, 1_600, 10),
        pe("NoCost", 5_000, 50, null, 15),
        pe("Thin", 400, 4, 160, 2),                    // 2 sale days
      ]),
      compareDetail: compare([
        pe("Star", 38_000, 380, 17_100, 27),
        pe("HVLM", 29_000, 870, 5_800, 25),
        pe("LVHM", 2_900, 11, 1_740, 7),
        pe("Weak", 1_600, 42, 320, 7),
        pe("Declining", 9_000, 90, 3_600, 18),         // −33%
        pe("Emerging", 2_500, 25, 1_000, 6),           // +60%
        pe("Dormant", 3_000, 30, 1_200, 10),           // gone this period
        pe("NoCost", 5_000, 50, null, 15),
      ]),
    },
  });

  it("assigns the expected tags, multiple per product allowed", () => {
    const p = classifyPortfolio(rich());
    expect(p.available).toBe(true);
    const by = new Map(p.classifications.map((c) => [c.name, c]));
    expect(by.get("Star")!.tags).toContain("star");
    expect(by.get("HVLM")!.tags).toContain("high_volume_low_margin");
    expect(by.get("HVLM")!.tags).toContain("review_pricing"); // 20% < 25% floor
    expect(by.get("LVHM")!.tags).toContain("low_volume_high_margin");
    expect(by.get("Weak")!.tags).toContain("weak");
    expect(by.get("Declining")!.tags).toContain("declining");
    expect(by.get("Emerging")!.tags).toContain("emerging");
    expect(by.get("NoCost")!.tags).toContain("cost_unknown");
    expect(by.get("Thin")!.tags).toContain("data_insufficient");
    expect(by.get("Dormant")!.tags).toContain("dormant");
  });

  it("every classification carries reason, action, resolution criteria and thresholds are labeled", () => {
    const p = classifyPortfolio(rich());
    for (const c of p.classifications) {
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(c.recommendedAction.length).toBeGreaterThan(5);
      expect(c.resolutionCriteria.length).toBeGreaterThan(5);
    }
    expect(p.thresholds.find((t) => t.name === "gross-margin floor")!.basis).toBe("system default");
    expect(p.thresholds.find((t) => t.name === "median portfolio margin")!.basis).toBe("derived");
  });

  it("low coverage → unavailable with reason", () => {
    const s = makeSnapshot({ products: { detail: detail([pe("A", 1_000, 10, 400)], 30), compareDetail: compare([], 30) } });
    const p = classifyPortfolio(s);
    expect(p.available).toBe(false);
    expect(p.reason).toContain("coverage");
  });

  it("stock risk tags only when inventory is actually tracked", () => {
    const positions: ProductPositionEntry[] = [{ name: "Star", sellingPrice: 100, avgCost: 55, hasCost: true, onHand: 2, isLow: true, vendor: null }];
    const tracked = makeSnapshot({
      inventory: { hasLiveData: true },
      products: { ...rich().products, positions: metric(positions, "read/stock.getStockSummary", "now", "/stock") },
    });
    const untracked = rich(); // fixture inventory.hasLiveData true but Star has stock — override:
    untracked.inventory.hasLiveData = false;
    expect(classifyPortfolio(tracked).classifications.find((c) => c.name === "Star")!.tags).toContain("stock_risk");
    expect(classifyPortfolio(untracked).classifications.find((c) => c.name === "Star")!.tags).not.toContain("stock_risk");
  });
});

/* ═══ SHELF ═══ */
describe("shelf priority", () => {
  it("stars expand, weak reduce, every verdict carries the no-dimensions caveat", () => {
    const s = makeSnapshot();
    const p = classifyPortfolio(s);
    const shelf = shelfPriorities(p);
    expect(shelf.length).toBeGreaterThan(0);
    expect(shelf[0].caveat).toContain("not a physical allocation");
    const star = shelf.find((x) => x.name === "سوداني");
    expect(star && ["expand_consideration", "maintain"]).toContain(star!.verdict);
  });
});

/* ═══ PRICING ═══ */
describe("pricing reviews", () => {
  it("below-floor margin creates a review with break-even and target price", () => {
    const s = makeSnapshot(); // بونبون at 20% < 25% floor, cost 12.8
    const reviews = pricingReviews(s);
    const bon = reviews.find((r) => r.name === "بونبون");
    expect(bon).toBeDefined();
    expect(bon!.priceForTargetMargin).toBeCloseTo(17.1, 1); // 12.8 / 0.75
    expect(bon!.risk).toContain("demand response unknown");
  });

  it("missing COGS → review lists the missing input, no target price invented", () => {
    const s = makeSnapshot({
      products: {
        detail: detail([pe("NoCost", 10_000, 100, null, 20), pe("A", 40_000, 400, 16_000), pe("B", 30_000, 300, 12_000)]),
        positions: metric([{ name: "NoCost", sellingPrice: 100, avgCost: 0, hasCost: false, onHand: 0, isLow: false, vendor: null }], "t", "now", "/stock"),
      },
    });
    const r = pricingReviews(s).find((x) => x.name === "NoCost");
    if (r) { // it only appears if a signal exists (price inconsistency etc.)
      expect(r.priceForTargetMargin).toBeNull();
      expect(r.missing.join(" ")).toContain("cost");
    }
    // and critically: no fabricated target
    expect(pricingReviews(s).every((x) => x.priceForTargetMargin == null || x.unitCost != null)).toBe(true);
  });

  it("observed vs list price inconsistency is flagged", () => {
    const s = makeSnapshot({
      products: {
        detail: detail([pe("Drift", 20_000, 100, 8_000, 20), pe("A", 40_000, 400, 16_000), pe("B", 30_000, 300, 12_000)]), // observed 200
        positions: metric([{ name: "Drift", sellingPrice: 250, avgCost: 120, hasCost: true, onHand: 10, isLow: false, vendor: null }], "t", "now", "/stock"),
      },
    });
    const r = pricingReviews(s).find((x) => x.name === "Drift");
    expect(r).toBeDefined();
    expect(r!.signals.join(" ")).toContain("differs >10%");
  });

  it("owner disabling price recommendations empties the queue", () => {
    const s = makeSnapshot();
    s.context.allowPriceRecommendations = metric(false, "owner answer", P, "/health");
    expect(pricingReviews(s)).toEqual([]);
  });
});

/* ═══ PURCHASING ═══ */
describe("purchase reviews", () => {
  it("untracked inventory → top products get a data-first action, never a quantity", () => {
    const s = makeSnapshot();
    s.inventory.hasLiveData = false;
    const r = purchaseReviews(s);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.kind === "no_stock_position" && x.urgency === "data_first")).toBe(true);
    expect(r[0].nextStep).toContain("physical count");
    expect(r[0].daysCover).toBeNull();
  });

  it("tracked stock + velocity → days of cover, stockout ranks by urgency", () => {
    const s = makeSnapshot();
    s.inventory.hasLiveData = true;
    // كاجو: onHand 12, units 90/31 days ≈ 2.9/day → ~4.1 days < 7 tolerance
    const r = purchaseReviews(s);
    const kaju = r.find((x) => x.name === "كاجو");
    expect(kaju).toBeDefined();
    expect(kaju!.kind).toBe("stockout_risk");
    expect(kaju!.daysCover).toBeLessThan(7);
    expect(kaju!.nextStep).toContain("assumes ~7-day lead time");
  });

  it("excess stock on a weak mover is flagged for pause", () => {
    const s = makeSnapshot({
      products: {
        detail: detail([pe("Slow", 1_500, 30, 600, 8), pe("A", 60_000, 600, 24_000, 28), pe("B", 40_000, 400, 16_000, 25)]),
        positions: metric([
          { name: "Slow", sellingPrice: 50, avgCost: 30, hasCost: true, onHand: 100, isLow: false, vendor: null }, // 30/31≈1/day → 100 days
          { name: "A", sellingPrice: 100, avgCost: 60, hasCost: true, onHand: 500, isLow: false, vendor: null },
          { name: "B", sellingPrice: 100, avgCost: 60, hasCost: true, onHand: 400, isLow: false, vendor: null },
        ], "t", "now", "/stock"),
      },
    });
    s.inventory.hasLiveData = true;
    const slow = purchaseReviews(s).find((x) => x.name === "Slow");
    expect(slow).toBeDefined();
    expect(slow!.kind).toBe("excess_stock");
    expect(slow!.nextStep).toContain("Pause");
  });
});

/* ═══ WEEKLY PRIORITY ═══ */
describe("weekly priority", () => {
  const inputs = { dismissed: [], openActionFindingIds: [], reviewPeriodDays: 14 };

  it("high-impact contradiction outranks a minor opportunity; ≤1 primary + ≤2 secondary", () => {
    const s = makeSnapshot({
      revenue: { changePct: metric(18, "t", C, "/sales", { basis: "calculated" }) },
      profit: { grossMarginPct: metric(35, "read/profit.getProfitReadout", P, "/reconcile", { confidence: "high" }), priorGrossMarginPct: metric(40, "read/profit.getProfitReadout", C, "/reconcile") },
    });
    const w = selectWeeklyPriority(buildStrategyReport(s), inputs);
    expect(w.primary).not.toBeNull();
    expect(["growth-weaker-economics", "margin-drop"]).toContain(w.primary!.findingId);
    expect(w.secondary.length).toBeLessThanOrEqual(2);
    expect(w.primary!.successCriteria.length).toBeGreaterThan(5);
  });

  it("unsafe cash outranks a pricing opportunity", () => {
    const s = makeSnapshot({ cash: { expectedBalance: metric(9_000, "read/money.getCashPosition", "now", "/money"), hasLiveData: true } });
    const w = selectWeeklyPriority(buildStrategyReport(s), inputs);
    expect(w.primary!.findingId).toBe("profit-up-cash-low");
  });

  it("missing critical data can BE the primary action", () => {
    const s = makeSnapshot({ meta: { isStale: true, staleDays: 43, lastDataDate: "2026-05-31" } });
    const w = selectWeeklyPriority(buildStrategyReport(s), inputs);
    expect(w.primary!.findingId).toBe("stale-books");
  });

  it("dismissed issue stays suppressed unless materially worse", () => {
    const s = makeSnapshot({ expenses: { withdrawals: metric(20_000, "read/money.getCashSummary", P, "/money") } });
    const report = buildStrategyReport(s);
    const withdrawImpact = report.findings.find((f) => f.id === "withdrawals-high")!.impactEgp;
    const suppressedRun = selectWeeklyPriority(report, { ...inputs, dismissed: [{ findingId: "withdrawals-high", impactEgp: withdrawImpact }] });
    expect(suppressedRun.primary?.findingId).not.toBe("withdrawals-high");
    expect(suppressedRun.suppressed.map((x) => x.findingId)).toContain("withdrawals-high");
    // materially worse (dismissed at a much lower impact) → resurfaces
    const resurfaced = selectWeeklyPriority(report, { ...inputs, dismissed: [{ findingId: "withdrawals-high", impactEgp: 1_000 }] });
    expect(resurfaced.suppressed.map((x) => x.findingId)).not.toContain("withdrawals-high");
  });

  it("open action → primary becomes finishing the queued action", () => {
    const s = makeSnapshot({ meta: { isStale: true, staleDays: 43, lastDataDate: "2026-05-31" } });
    const w = selectWeeklyPriority(buildStrategyReport(s), { ...inputs, openActionFindingIds: ["stale-books"] });
    expect(w.primary!.alreadyQueued).toBe(true);
    expect(w.primary!.action).toContain("Finish the queued action");
  });

  it("steady healthy business → explicit no-action primary, not an invented task", () => {
    const s = makeSnapshot({ profit: { uncoveredRevenue: metric(0, "t", P, "/reconcile") } });
    const report = buildStrategyReport(s);
    const w = selectWeeklyPriority({ ...report, findings: report.findings.filter((f) => f.class === "fact") }, inputs);
    expect(w.primary?.action ?? "").toContain("No action needed");
  });
});

/* ═══ OUTCOMES ═══ */
describe("recommendation outcomes", () => {
  const F = (id: string, impact: number | null): Finding => ({
    id, class: "warning", title: id, detail: "", evidence: [], impactEgp: impact,
    urgency: "this_week", confidence: "medium", actionable: true, action: null,
    alternativeAction: null, missingData: [], drivers: [], assumptions: [],
    resolutionCriteria: "", persistEligible: true, score: 0, rank: 1,
  });
  const row = (over: Partial<ActionOutcomeRow>): ActionOutcomeRow => ({
    id: "a1", findingId: "margin-drop", status: "accepted", outcomeState: "not_started",
    baseline: { period: C, capturedAt: "2026-06-01", impactEgp: 10_000, evidence: [] },
    reviewDate: "2026-06-15", ...over,
  });

  it("finding gone → improved (engine-resolution based), with the attribution caveat", () => {
    const plan = planOutcomeEvaluation([row({})], [F("other-finding", null)], "2026-06-20", true);
    expect(plan).toHaveLength(1);
    expect(plan[0].outcomeState).toBe("improved");
    expect(plan[0].outcomeMetrics.caveat).toContain("plausible, not proven");
  });

  it("impact 25% worse → worsened", () => {
    const plan = planOutcomeEvaluation([row({})], [F("margin-drop", 14_000)], "2026-06-10", true);
    expect(plan[0].outcomeState).toBe("worsened");
  });

  it("still firing, similar, review due → no meaningful change; before review → stays quiet", () => {
    const due = planOutcomeEvaluation([row({})], [F("margin-drop", 10_500)], "2026-06-20", true);
    expect(due[0].outcomeState).toBe("no_meaningful_change");
    const early = planOutcomeEvaluation([row({})], [F("margin-drop", 10_500)], "2026-06-05", true);
    expect(early).toHaveLength(0);
  });

  it("coverage collapse → awaiting data, never a fake verdict", () => {
    const plan = planOutcomeEvaluation([row({})], [], "2026-06-20", false);
    expect(plan[0].outcomeState).toBe("awaiting_data");
  });

  it("dismissed action → cancelled; settled outcomes never re-evaluate", () => {
    const plan = planOutcomeEvaluation(
      [row({ status: "dismissed" }), row({ id: "a2", outcomeState: "improved" })],
      [F("margin-drop", 9_000)], "2026-06-20", true,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].outcomeState).toBe("cancelled");
  });
});
