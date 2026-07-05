/** Business snapshot — the SINGLE grounded fact-base handed to the AI strategist.
 *  Assembled entirely from the app's audited READ layer + heuristic engine outputs;
 *  no financial logic is reinvented here and NOTHING is written. Numbers are
 *  pre-computed so the Edge Function never does business math. Product-level reads
 *  are flagged as partial-coverage (only a subset of days have product-line detail).
 *  READ-ONLY. */
import { todayCairo, monthBoundsCairo, lastMonthBoundsCairo } from "@/core/time";
import { lastNDays } from "@/core/utils/date";
import { ALL_TIME_FROM } from "@/core/range";
import { getRevenueTotal, getSalesStats } from "@/core/read/sales";
import { getProfitReadout } from "@/core/read/profit";
import { getCashSummary } from "@/core/read/money";
import { getChequeCycle } from "@/core/read/settlements";
import { getStockSummary } from "@/core/read/stock";
import { getRevenueForecast } from "@/core/read/forecast";
import { getHealthReport } from "@/core/read/health";
import { getRiskInsights } from "@/core/read/insights";
import { getMissingData } from "@/core/read/missing";
import { getLifetimeProducts, getProductProfit } from "@/core/read/products";
import { getBudgetStatus } from "@/core/read/budgets";
import { getExpenseCategoryTrends, getOperatingExpenseTotal, getInventorySpendTotal } from "@/core/read/expenses";
import { getAnalytics } from "@/core/read/analytics";

const r0 = (n: number | null | undefined) => (n == null ? null : Math.round(n));
const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);

/** Trend/BI signals over the FULL monthly revenue history (all trading days) —
 *  trajectory, MoM, YoY, best/worst. Computed, never invented. */
function computeTrends(monthly: { label: string; value: number }[]) {
  const ms = [...monthly].filter((m) => m.value > 0).sort((a, b) => a.label.localeCompare(b.label));
  const n = ms.length;
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const last = ms[n - 1], prev = ms[n - 2];
  const momPct = last && prev && prev.value ? ((last.value - prev.value) / prev.value) * 100 : null;
  const last3 = avg(ms.slice(-3).map((m) => m.value));
  const prior3 = avg(ms.slice(-6, -3).map((m) => m.value));
  const traj = last3 != null && prior3 != null && prior3 > 0 ? (last3 - prior3) / prior3 : null;
  const trajectory = traj == null ? "unknown" : traj > 0.05 ? "rising" : traj < -0.05 ? "falling" : "flat";
  const best = ms.reduce<{ label: string; value: number } | null>((a, b) => (b.value > (a?.value ?? -1) ? b : a), null);
  const worst = ms.reduce<{ label: string; value: number } | null>((a, b) => (b.value < (a?.value ?? Infinity) ? b : a), null);
  let yoy: number | null = null;
  if (last) {
    const [y, m] = last.label.split("-");
    const py = ms.find((x) => x.label === `${+y - 1}-${m}`);
    if (py && py.value) yoy = ((last.value - py.value) / py.value) * 100;
  }
  return { monthsOfData: n, trajectory, momPct, yoy, last3, prior3, best, worst };
}

export interface BusinessSnapshot {
  generatedFor: string;
  coverage: {
    daysTraded: number;
    productDetail: string; // explicit partial-coverage caveat
  };
  revenue: { allTime: number | null; last30: number | null; thisMonth: number | null; lastMonth: number | null; dailyAvgLast30: number | null; momGrowthPct: number | null };
  profit: { thisMonthGross: number | null; thisMonthNet: number | null; grossMarginPct: number | null; complete: boolean; missingCostLines: number; note: string };
  cash: { onHand: number | null; inflow30: number | null; outflow30: number | null; withdrawals30: number | null };
  settlement: { model: string; totalReceived: number | null; blendedDeductionPct: number | null; openTabRevenue: number | null; openTabDays: number | null };
  stock: { totalValue: number | null; lowCount: number; negativeCount: number; missingCostCount: number; topByValue: { name: string; vendor: string | null; value: number | null; onHand: number | null }[] };
  expenses: { operating30: number | null; inventory30: number | null; topCategories: { category: string; amount: number | null; changePct: number | null }[] };
  products: {
    coverageNote: string;
    topByMargin: { name: string; marginPct: number | null; revenue: number | null; costSource: string }[];
    bottomByMargin: { name: string; marginPct: number | null; revenue: number | null; costSource: string }[];
    topByRevenue: { name: string; revenue: number | null }[];
  };
  series: { monthlyRevenue: { month: string; revenue: number | null }[]; dayOfWeek: { day: string; avg: number | null }[] };
  trends: {
    monthsOfData: number;
    trajectory: string; // rising | falling | flat | unknown (last 3 mo vs prior 3)
    momPct: number | null; // latest full month vs previous
    yoyLatestPct: number | null; // latest month vs same month a year earlier
    last3Avg: number | null; prior3Avg: number | null;
    best: { month: string; revenue: number } | null;
    worst: { month: string; revenue: number } | null;
    topRevenueDays: { date: string; revenue: number | null }[];
  };
  forecast: { next7: number | null; next30: number | null; confidence: string; basis: string };
  heuristics: {
    health: { overall: number | null; status: string; categories: { label: string; score: number | null; reason: string }[] };
    risks: { severity: string; title: string; detail: string; confidence: string }[];
    dataGaps: { title: string; severity: string; count: number }[];
    budgets: { configured: boolean; rows: { label: string; target: number; actual: number | null; status: string }[] };
  };
}

/** Assemble the full grounded snapshot from the audited read layer. */
export async function assembleSnapshot(): Promise<BusinessSnapshot> {
  const today = todayCairo();
  const allTime = { from: ALL_TIME_FROM, to: today };
  const tM = monthBoundsCairo();
  const lM = lastMonthBoundsCairo();
  const l30 = lastNDays(30);

  const [
    revAll, rev30, revThis, revLast, salesAll,
    profitThis, cash30, cycle, stock, forecast,
    health, risks, gaps, lifetime, prodProfit,
    budgets, expTrends, opex30, invSpend30, analytics,
  ] = await Promise.all([
    getRevenueTotal(allTime), getRevenueTotal(l30), getRevenueTotal(tM), getRevenueTotal(lM), getSalesStats(allTime),
    getProfitReadout(tM), getCashSummary(l30), getChequeCycle(), getStockSummary(), getRevenueForecast(180),
    getHealthReport(), getRiskInsights(), getMissingData(), getLifetimeProducts(), getProductProfit(allTime),
    getBudgetStatus(), getExpenseCategoryTrends(l30, { from: lastNDays(60).from, to: l30.from }), getOperatingExpenseTotal(l30), getInventorySpendTotal(l30), getAnalytics(allTime),
  ]);

  const momGrowth = revThis != null && revLast ? ((revThis - revLast) / revLast) * 100 : null;
  const dailyAvg30 = rev30 != null ? rev30 / 30 : null;

  // product margin movers — lifetime, cost-sourced, over the partial product-detail export
  const costed = lifetime.filter((p) => p.margin != null && p.revenue > 0).sort((a, b) => (b.margin! - a.margin!));
  const topByRevenue = [...prodProfit].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  return {
    generatedFor: today,
    coverage: {
      daysTraded: salesAll.days,
      productDetail: `Product-line detail exists for only a subset of the ${salesAll.days} trading days (the daily-report imports). Whole-business revenue/cash/cheque figures cover the full history; per-product reads below are from those partial detail days only.`,
    },
    revenue: {
      allTime: r0(revAll), last30: r0(rev30), thisMonth: r0(revThis), lastMonth: r0(revLast),
      dailyAvgLast30: r0(dailyAvg30), momGrowthPct: r1(momGrowth),
    },
    profit: {
      thisMonthGross: r0(profitThis.grossProfit), thisMonthNet: r0(profitThis.netProfit),
      grossMarginPct: r1(profitThis.margin), complete: profitThis.complete, missingCostLines: profitThis.missingCostLines,
      note: profitThis.complete ? "COGS complete for the mapped lines this month" : "profit withheld where sold lines lack a recorded cost — never guessed",
    },
    cash: { onHand: r0(cash30.balance), inflow30: r0(cash30.inflow), outflow30: r0(cash30.outflow), withdrawals30: r0(cash30.withdrawals) },
    settlement: {
      model: "Mall concession: 15,000 EGP/month rent + 3% revenue charge (was 20% commission historically). Settled by lumpy cheques after a lag.",
      totalReceived: r0(cycle.totalReceived), blendedDeductionPct: r1(cycle.blendedDeductionPct),
      openTabRevenue: r0(cycle.openTab?.revenue ?? null), openTabDays: cycle.openTab?.days ?? null,
    },
    stock: {
      totalValue: r0(stock.totalValue), lowCount: stock.lowCount, negativeCount: stock.negativeCount, missingCostCount: stock.missingCostCount,
      topByValue: stock.positions.slice(0, 8).map((p) => ({ name: p.nameEn, vendor: p.vendor, value: r0(p.stockValue), onHand: r1(p.onHand) })),
    },
    expenses: {
      operating30: r0(opex30), inventory30: r0(invSpend30),
      topCategories: expTrends.slice(0, 6).map((c) => ({ category: c.category, amount: r0(c.amount), changePct: r1(c.changePct) })),
    },
    products: {
      coverageNote: "Per-product margins below are from the partial product-detail history, cost-sourced (verified / estimate / unknown). Treat as directional, not the full book.",
      topByMargin: costed.slice(0, 6).map((p) => ({ name: p.name, marginPct: r1(p.margin), revenue: r0(p.revenue), costSource: p.costSource })),
      bottomByMargin: costed.slice(-6).reverse().map((p) => ({ name: p.name, marginPct: r1(p.margin), revenue: r0(p.revenue), costSource: p.costSource })),
      topByRevenue: topByRevenue.map((p) => ({ name: p.name, revenue: r0(p.revenue) })),
    },
    series: {
      monthlyRevenue: analytics.monthlyRevenue.map((s) => ({ month: s.label, revenue: r0(s.value) })),
      dayOfWeek: analytics.dayOfWeek.map((s) => ({ day: s.label, avg: r0(s.value) })),
    },
    trends: (() => {
      const t = computeTrends(analytics.monthlyRevenue);
      return {
        monthsOfData: t.monthsOfData, trajectory: t.trajectory, momPct: r1(t.momPct), yoyLatestPct: r1(t.yoy),
        last3Avg: r0(t.last3), prior3Avg: r0(t.prior3),
        best: t.best ? { month: t.best.label, revenue: r0(t.best.value)! } : null,
        worst: t.worst ? { month: t.worst.label, revenue: r0(t.worst.value)! } : null,
        topRevenueDays: analytics.topRevenueDays.slice(0, 8).map((d) => ({ date: d.date, revenue: r0(d.total) })),
      };
    })(),
    forecast: { next7: r0(forecast.next7), next30: r0(forecast.next30), confidence: forecast.confidence, basis: forecast.basis },
    heuristics: {
      health: {
        overall: health.overall, status: health.status,
        categories: health.categories.map((c) => ({ label: c.label, score: c.score, reason: c.reason })),
      },
      risks: risks.slice(0, 8).map((i) => ({ severity: i.severity, title: i.title, detail: i.detail, confidence: i.confidence })),
      dataGaps: gaps.map((g) => ({ title: g.title, severity: g.severity, count: g.count })),
      budgets: {
        configured: budgets.configured,
        rows: budgets.rows.map((b) => ({ label: b.label, target: b.target, actual: b.actual, status: b.status })),
      },
    },
  };
}
