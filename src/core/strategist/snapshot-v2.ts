/** Snapshot v2 assembler.
 *
 *  Split in two so the money-shaping logic is unit-testable without a network:
 *  - composeSnapshotV2(inputs)  — PURE. Raw read-model outputs in, typed
 *    snapshot out. All derivations (rolling averages, unusual days, spikes,
 *    growth/decline, completeness score) happen here.
 *  - assembleSnapshotV2()       — I/O. Gathers the inputs from the audited
 *    read layer (src/core/read/*) and calls the pure composer.
 *
 *  RULE 9 still holds: read-only over business data. */
import { todayCairo, isoDaysAgo } from "@/core/time";
import { getDailyRevenue } from "@/core/read/sales";
import { getProfitReadout, type ProfitReadout } from "@/core/read/profit";
import { getProductProfit, type ProductProfit } from "@/core/read/products";
import { getStockSummary, type StockSummary } from "@/core/read/stock";
import { getCashPosition, getCashSummary, type CashPosition, type CashSummary } from "@/core/read/money";
import type { ChequeCycle } from "@/core/settlement/cheque-cycle";
import { getChequeCycle, getSettlementStatements, type SettlementStatement } from "@/core/read/settlements";
import { getExpenseCategoryTrends, type ExpenseCatStat } from "@/core/read/expenses";
import { getMissingData, type MissingIssue } from "@/core/read/missing";
import { requireEngine } from "@/core/db/engine";
import { loadOwnerContext, composeContext, type OwnerContextAnswers } from "./context";
import {
  metric, missing, type StrategistSnapshot, type DayPoint, type NamedValue,
  type ProductEntry, type ProductPeriodEntry, type Confidence, type DataQualityIssue,
} from "./contract";

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface SnapshotInputs {
  today: string;
  /** full daily revenue history (all-time), ascending */
  daily: DayPoint[];
  period: { from: string; to: string };
  compare: { from: string; to: string };
  profitPeriod: ProfitReadout;
  profitCompare: ProfitReadout;
  /** last up-to-6 month readouts for the profit series, oldest first */
  profitMonths: { month: string; readout: ProfitReadout }[];
  productsPeriod: ProductProfit[];
  productsCompare: ProductProfit[];
  stock: StockSummary;
  cashPos: CashPosition;
  cashSummary: CashSummary;
  latestCashCount: { date: string; counted: number; expected: number } | null;
  cycle: ChequeCycle;
  statements: SettlementStatement[];
  expenseTrends: ExpenseCatStat[];
  missingData: MissingIssue[];
  ownerAnswers: OwnerContextAnswers | null;
}

/* ── pure helpers ─────────────────────────────────────────────────────── */

function inWindow(daily: DayPoint[], from: string, to: string): DayPoint[] {
  return daily.filter((d) => d.date >= from && d.date <= to);
}
const sum = (ps: DayPoint[]) => ps.reduce((s, p) => s + p.total, 0);

function weekdayPattern(points: DayPoint[]): NamedValue[] {
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const buckets = new Map<number, { total: number; n: number }>();
  for (const p of points) {
    const wd = new Date(p.date + "T00:00:00Z").getUTCDay();
    const b = buckets.get(wd) ?? { total: 0, n: 0 };
    b.total += p.total; b.n += 1; buckets.set(wd, b);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b)
    .map(([wd, b]) => ({ name: WD[wd], value: r0(b.total / Math.max(1, b.n)) }));
}

function unusualDays(points: DayPoint[]): DayPoint[] {
  if (points.length < 14) return [];
  const mean = sum(points) / points.length;
  const sd = Math.sqrt(points.reduce((s, p) => s + (p.total - mean) ** 2, 0) / points.length);
  if (sd === 0) return [];
  return points.filter((p) => Math.abs(p.total - mean) > 2.5 * sd);
}

function toEntry(p: ProductProfit): ProductEntry {
  return {
    name: p.name, revenue: r0(p.revenue), units: r1(p.units),
    grossProfit: p.grossProfit == null ? null : r0(p.grossProfit),
    marginPct: p.margin == null ? null : r1(p.margin),
    missingCost: p.missingCostLines > 0,
  };
}
function toPeriodEntry(p: ProductProfit): ProductPeriodEntry {
  return { ...toEntry(p), cogs: r0(p.cogs), daysSold: p.lines };
}

/** Confidence from data completeness: the honesty dial. */
export function coverageConfidence(coveredPct: number | null, missingCostLines: number): Confidence {
  if (coveredPct == null || coveredPct === 0) return "none";
  if (coveredPct >= 95 && missingCostLines === 0) return "high";
  if (coveredPct >= 60) return "medium";
  return "low";
}

/* ── the pure composer ────────────────────────────────────────────────── */

export function composeSnapshotV2(i: SnapshotInputs): StrategistSnapshot {
  const P = `${i.period.from}→${i.period.to}`;
  const C = `${i.compare.from}→${i.compare.to}`;
  const SALES = "read/sales.getDailyRevenue";
  const PROFIT = "read/profit.getProfitReadout";
  const PRODUCTS = "read/products.getProductProfit";

  const periodPts = inWindow(i.daily, i.period.from, i.period.to);
  const comparePts = inWindow(i.daily, i.compare.from, i.compare.to);
  const periodRev = sum(periodPts);
  const priorRev = sum(comparePts);
  const lastDataDate = i.daily.length ? i.daily[i.daily.length - 1].date : null;
  const staleDays = lastDataDate
    ? Math.max(0, Math.round((Date.parse(i.today) - Date.parse(lastDataDate)) / 86_400_000))
    : null;

  // rolling windows end at the LAST DATA DATE, not today — otherwise a stale
  // book reads as a collapse.
  const anchor = lastDataDate ?? i.today;
  const roll7 = inWindow(i.daily, isoDaysAgo(anchor, 6), anchor);
  const roll30 = inWindow(i.daily, isoDaysAgo(anchor, 29), anchor);

  const changePct = priorRev > 0 ? ((periodRev - priorRev) / priorRev) * 100 : null;

  /* products: growth/decline vs compare period */
  const byNamePrior = new Map(i.productsCompare.map((p) => [p.name, p]));
  const withChange = i.productsPeriod
    .filter((p) => p.productId !== "__unmapped__")
    .map((p) => {
      const prior = byNamePrior.get(p.name);
      const changePct = prior && prior.revenue > 0 ? ((p.revenue - prior.revenue) / prior.revenue) * 100 : null;
      return { ...toEntry(p), changePct };
    });
  const grown = withChange.filter((p) => p.changePct != null && p.changePct > 15 && p.revenue > 500)
    .sort((a, b) => (b.changePct! - a.changePct!)).slice(0, 6) as (ProductEntry & { changePct: number })[];
  const declined = withChange.filter((p) => p.changePct != null && p.changePct < -15 && (byNamePrior.get(p.name)?.revenue ?? 0) > 500)
    .sort((a, b) => (a.changePct! - b.changePct!)).slice(0, 6) as (ProductEntry & { changePct: number })[];

  const entries = i.productsPeriod.filter((p) => p.productId !== "__unmapped__").map(toEntry);
  const totalUnits = entries.reduce((s, e) => s + e.units, 0);
  const medianMargin = (() => {
    const ms = entries.map((e) => e.marginPct).filter((m): m is number => m != null).sort((a, b) => a - b);
    return ms.length ? ms[Math.floor(ms.length / 2)] : null;
  })();
  const hvlm = medianMargin == null ? [] : entries
    .filter((e) => e.marginPct != null && e.marginPct < medianMargin && e.units > totalUnits / Math.max(1, entries.length))
    .sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  const lvhm = medianMargin == null ? [] : entries
    .filter((e) => e.marginPct != null && e.marginPct > medianMargin && e.units <= totalUnits / Math.max(1, entries.length))
    .sort((a, b) => (b.marginPct! - a.marginPct!)).slice(0, 6);

  /* expenses */
  const expCats = i.expenseTrends.map((t) => ({
    name: t.category, value: r0(t.amount), priorValue: r0(t.prior),
    changePct: t.changePct == null ? null : r1(t.changePct),
  }));
  const spikes = expCats
    .filter((c): c is typeof c & { changePct: number } => c.changePct != null && c.changePct > 30 && c.value - c.priorValue > 1000)
    .map((c) => ({ name: c.name, value: c.value, changePct: c.changePct }));

  /* cheques */
  const received = i.statements.filter((s) => s.chequeReceived != null);
  const overdue = i.statements
    .filter((s) => s.chequeReceived == null && s.netExpected > 0 && s.end != null && s.end < isoDaysAgo(i.today, 45))
    .map((s) => s.month);
  const lastCheque = i.cycle.cheques[0] ?? null;

  /* data quality */
  const dq: DataQualityIssue[] = [];
  if (i.profitPeriod.uncoveredRevenue >= 1) dq.push({ issue: `EGP ${r0(i.profitPeriod.uncoveredRevenue).toLocaleString()} of period revenue has no product-line detail (COGS unknowable)`, affectedEgp: r0(i.profitPeriod.uncoveredRevenue), screenLink: "/reconcile" });
  if (i.profitPeriod.missingCostLines > 0) dq.push({ issue: `${i.profitPeriod.missingCostLines} sold lines lack a recorded cost`, affectedEgp: null, screenLink: "/costs" });
  if (staleDays != null && staleDays > 3) dq.push({ issue: `Books end ${lastDataDate} — ${staleDays} days behind`, affectedEgp: null, screenLink: "/sales" });
  if (!i.latestCashCount) dq.push({ issue: "No physical cash count has ever been recorded", affectedEgp: null, screenLink: "/money" });
  if (i.stock.positions.every((p) => p.onHand === 0)) dq.push({ issue: "Inventory has no live data (no counts or purchases recorded)", affectedEgp: null, screenLink: "/stock" });
  for (const m of i.missingData.slice(0, 6)) dq.push({ issue: m.title, affectedEgp: null, screenLink: m.route || "/missing" });

  const completenessScore = r0(
    (i.profitPeriod.coveredPct ?? 0) * 0.4 +
    (i.profitPeriod.missingCostLines === 0 ? 100 : 60) * 0.2 +
    (i.latestCashCount ? 100 : 0) * 0.15 +
    (i.stock.positions.some((p) => p.onHand !== 0) ? 100 : 0) * 0.1 +
    (staleDays != null && staleDays <= 3 ? 100 : 40) * 0.15,
  );

  const profConf = coverageConfidence(i.profitPeriod.coveredPct, i.profitPeriod.missingCostLines);
  const stockHasData = i.stock.positions.some((p) => p.onHand !== 0);
  const cashHasData = i.latestCashCount != null || i.cashSummary.withdrawals > 0 || i.cashPos.opening > 0;

  const mappedPeriod = i.productsPeriod.filter((p) => p.productId !== "__unmapped__");
  const mappedCompare = i.productsCompare.filter((p) => p.productId !== "__unmapped__");
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      businessClock: "Africa/Cairo",
      today: i.today,
      period: { ...i.period, label: P },
      comparePeriod: { ...i.compare, label: C },
      lastDataDate,
      staleDays,
      isStale: staleDays != null && staleDays > 3,
      completenessScore,
    },
    revenue: {
      periodRevenue: metric(r0(periodRev), SALES, P, "/sales"),
      priorRevenue: metric(r0(priorRev), SALES, C, "/sales"),
      changePct: changePct == null
        ? missing(SALES, C, "/sales", "no prior-period revenue to compare against")
        : metric(r1(changePct), SALES, `${C} → ${P}`, "/sales", { basis: "calculated" }),
      rolling7Avg: metric(r0(roll7.length ? sum(roll7) / roll7.length : 0), SALES, `7d to ${anchor}`, "/sales", { basis: "calculated" }),
      rolling30Avg: metric(r0(roll30.length ? sum(roll30) / roll30.length : 0), SALES, `30d to ${anchor}`, "/sales", { basis: "calculated" }),
      bestDays: metric([...periodPts].sort((a, b) => b.total - a.total).slice(0, 3), SALES, P, "/sales"),
      weakestDays: metric([...periodPts].filter((p) => p.total > 0).sort((a, b) => a.total - b.total).slice(0, 3), SALES, P, "/sales"),
      dayOfWeekPattern: metric(weekdayPattern(roll30.length >= 14 ? roll30 : periodPts), SALES, `30d to ${anchor}`, "/sales", { basis: "calculated" }),
      monthlySeries: metric(
        (() => { const m = new Map<string, number>(); for (const p of i.daily) m.set(p.date.slice(0, 7), (m.get(p.date.slice(0, 7)) ?? 0) + p.total); return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => ({ name, value: r0(value) })); })(),
        SALES, "all-time", "/reports", { basis: "calculated" },
      ),
      unusualDays: metric(unusualDays(periodPts), SALES, P, "/sales", { basis: "calculated", note: ">2.5σ from the period mean" }),
    },
    profit: {
      revenue: metric(r0(i.profitPeriod.revenue), PROFIT, P, "/reconcile"),
      coveredRevenue: metric(r0(i.profitPeriod.coveredRevenue), PROFIT, P, "/reconcile", { completeness: i.profitPeriod.coveredPct }),
      uncoveredRevenue: metric(r0(i.profitPeriod.uncoveredRevenue), PROFIT, P, "/reconcile", { note: "revenue on days with no product lines — COGS unknowable" }),
      knownCogs: metric(r0(i.profitPeriod.cogs), PROFIT, P, "/reconcile", { completeness: i.profitPeriod.coveredPct }),
      grossProfit: i.profitPeriod.grossProfit == null
        ? missing(PROFIT, P, "/reconcile", "withheld — cost data incomplete for the whole period")
        : metric(r0(i.profitPeriod.grossProfit), PROFIT, P, "/reconcile", { basis: "calculated", confidence: profConf }),
      operatingExpenses: metric(r0(i.profitPeriod.operatingExpenses), "read/expenses.getOperatingExpenseTotal", P, "/expenses", { note: "personal withdrawals are excluded by construction" }),
      netProfit: i.profitPeriod.netProfit == null
        ? missing(PROFIT, P, "/reconcile", "withheld — gross profit unknowable")
        : metric(r0(i.profitPeriod.netProfit), PROFIT, P, "/reconcile", { basis: "calculated", confidence: profConf }),
      grossMarginPct: i.profitPeriod.margin == null
        ? missing(PROFIT, P, "/reconcile", "no costed product lines in period")
        : metric(r1(i.profitPeriod.margin), PROFIT, P, "/reconcile", { basis: "calculated", confidence: profConf, completeness: i.profitPeriod.coveredPct, note: "margin on covered revenue only" }),
      netMarginPct: i.profitPeriod.netMargin == null
        ? missing(PROFIT, P, "/reconcile", "net profit unknowable")
        : metric(r1(i.profitPeriod.netMargin), PROFIT, P, "/reconcile", { basis: "calculated", confidence: profConf }),
      priorGrossMarginPct: i.profitCompare.margin == null
        ? missing(PROFIT, C, "/reconcile", "no costed lines in the comparison period")
        : metric(r1(i.profitCompare.margin), PROFIT, C, "/reconcile", { basis: "calculated", confidence: coverageConfidence(i.profitCompare.coveredPct, i.profitCompare.missingCostLines) }),
      monthlyProfitSeries: metric(
        i.profitMonths.map((m) => ({ month: m.month, revenue: r0(m.readout.revenue), knownCogs: r0(m.readout.cogs), uncovered: r0(m.readout.uncoveredRevenue), opex: r0(m.readout.operatingExpenses) })),
        PROFIT, `last ${i.profitMonths.length} months`, "/reports", { basis: "calculated" },
      ),
    },
    products: {
      detail: metric(mappedPeriod.map(toPeriodEntry), PRODUCTS, P, "/reports", { confidence: profConf, completeness: i.profitPeriod.coveredPct }),
      compareDetail: metric(mappedCompare.map(toPeriodEntry), PRODUCTS, C, "/reports", { confidence: coverageConfidence(i.profitCompare.coveredPct, i.profitCompare.missingCostLines), completeness: i.profitCompare.coveredPct }),
      periodDays: metric(periodPts.length, SALES, P, "/sales"),
      comparePeriodDays: metric(comparePts.length, SALES, C, "/sales"),
      positions: metric(
        i.stock.positions.filter((p) => p.active).map((p) => ({
          name: p.nameEn, sellingPrice: p.sellingPrice, avgCost: p.avgCost,
          hasCost: p.hasCost, onHand: p.onHand, isLow: p.isLow, vendor: p.vendor,
        })),
        "read/stock.getStockSummary", "now", "/stock",
        { confidence: stockHasData ? "high" : "low", note: stockHasData ? undefined : "stock quantities are untracked (no counts/purchases recorded); price and cost fields remain valid" },
      ),
      coveragePct: i.profitPeriod.coveredPct == null
        ? missing(PROFIT, P, "/sales/product-lines", "no product lines in period")
        : metric(r1(i.profitPeriod.coveredPct), PROFIT, P, "/sales/product-lines", { basis: "calculated" }),
      topRevenue: metric(entries.slice().sort((a, b) => b.revenue - a.revenue).slice(0, 8), PRODUCTS, P, "/reports", { confidence: profConf }),
      topGrossProfit: metric(entries.filter((e) => e.grossProfit != null).sort((a, b) => b.grossProfit! - a.grossProfit!).slice(0, 8), PRODUCTS, P, "/reports", { confidence: profConf }),
      highestMargin: metric(entries.filter((e) => e.marginPct != null && e.revenue > 500).sort((a, b) => b.marginPct! - a.marginPct!).slice(0, 6), PRODUCTS, P, "/reports", { confidence: profConf }),
      fastestGrowing: metric(grown, PRODUCTS, `${C} → ${P}`, "/reports", { basis: "calculated", confidence: profConf }),
      fastestDeclining: metric(declined, PRODUCTS, `${C} → ${P}`, "/reports", { basis: "calculated", confidence: profConf }),
      highVolumeLowMargin: metric(hvlm, PRODUCTS, P, "/reports", { basis: "calculated", confidence: profConf, note: "above-average volume, below-median margin" }),
      lowVolumeHighMargin: metric(lvhm, PRODUCTS, P, "/reports", { basis: "calculated", confidence: profConf, note: "below-average volume, above-median margin" }),
      missingCosts: metric(i.stock.positions.filter((p) => p.active && !p.hasCost).map((p) => p.nameEn), "read/stock.getStockSummary", "now", "/costs"),
      stockRisk: stockHasData
        ? metric(i.stock.positions.filter((p) => p.active && (p.isLow || p.onHand < 0)).map((p) => ({ name: p.nameEn, daysCover: null, onHand: p.onHand })), "read/stock.getStockSummary", "now", "/stock")
        : missing("read/stock.getStockSummary", "now", "/stock", "inventory not tracked yet — no counts or purchases recorded"),
    },
    inventory: {
      trackedProducts: metric(i.stock.positions.filter((p) => p.active).length, "read/stock.getStockSummary", "now", "/stock"),
      stockValue: stockHasData
        ? metric(r0(i.stock.totalValue), "read/stock.getStockSummary", "now", "/stock")
        : missing("read/stock.getStockSummary", "now", "/stock", "no stock has ever been counted or purchased in the system"),
      negativeStock: metric(i.stock.positions.filter((p) => p.onHand < 0).length, "read/stock.getStockSummary", "now", "/stock"),
      lowStock: metric(i.stock.positions.filter((p) => p.active && p.isLow).length, "read/stock.getStockSummary", "now", "/stock"),
      hasLiveData: stockHasData,
      lastPhysicalCount: missing("physical_counts", "all-time", "/stock", "no physical count recorded yet"),
    },
    expenses: {
      operatingTotal: metric(r0(i.profitPeriod.operatingExpenses), "read/expenses.getOperatingExpenseTotal", P, "/expenses"),
      priorOperatingTotal: metric(r0(i.profitCompare.operatingExpenses), "read/expenses.getOperatingExpenseTotal", C, "/expenses"),
      categories: metric(expCats, "read/expenses.getExpenseCategoryTrends", `${C} vs ${P}`, "/expenses", { basis: "calculated" }),
      spikes: metric(spikes, "read/expenses.getExpenseCategoryTrends", `${C} vs ${P}`, "/expenses", { basis: "calculated", note: ">30% and >EGP 1,000 above prior period" }),
      recurringMonthly: metric(
        expCats.filter((c) => c.value > 0 && c.priorValue > 0)
          .map((c) => ({ name: c.name, avgMonthly: r0((c.value + c.priorValue) / 2), isOperating: !/inventory|stock|مخزون/i.test(c.name) }))
          .sort((a, b) => b.avgMonthly - a.avgMonthly),
        "read/expenses.getExpenseCategoryTrends", `${C} & ${P}`, "/expenses",
        { basis: "calculated", confidence: "medium", note: "derived: categories present in BOTH recent periods; average of the two; inventory-like categories flagged non-operating" },
      ),
      withdrawals: metric(r0(i.cashSummary.withdrawals), "read/money.getCashSummary", P, "/money", { note: "NEVER part of operating expenses" }),
    },
    cash: {
      expectedBalance: metric(r0(i.cashPos.onHand), "read/money.getCashPosition", "now", "/money", {
        basis: "calculated",
        confidence: cashHasData ? "medium" : "low",
        note: i.cashPos.since ? `opening anchor ${i.cashPos.since}` : "all-time net: cheques − expenses − purchases (no cash movements recorded)",
      }),
      latestCount: i.latestCashCount
        ? metric(r0(i.latestCashCount.counted), "cash_reconciliations (latest)", i.latestCashCount.date, "/money")
        : missing("cash_reconciliations", "all-time", "/money", "no drawer count has ever been recorded"),
      unexplainedDifference: i.latestCashCount
        ? metric(r0(i.latestCashCount.counted - i.latestCashCount.expected), "cash_reconciliations (latest)", i.latestCashCount.date, "/money", { basis: "calculated" })
        : missing("cash_reconciliations", "all-time", "/money", "cannot know without a physical count"),
      inflows: metric(r0(i.cashSummary.inflow), "read/money.getCashSummary", P, "/money"),
      outflows: metric(r0(Math.abs(i.cashSummary.outflow)), "read/money.getCashSummary", P, "/money"),
      withdrawals: metric(r0(i.cashSummary.withdrawals), "read/money.getCashSummary", P, "/money"),
      injections: missing("money_movements", P, "/money", "no owner injections recorded yet"),
      lastCountDate: i.latestCashCount
        ? metric(i.latestCashCount.date, "cash_reconciliations", "latest", "/money")
        : missing("cash_reconciliations", "all-time", "/money", "never counted"),
      countAgeDays: i.latestCashCount
        ? metric(Math.max(0, Math.round((Date.parse(i.today) - Date.parse(i.latestCashCount.date)) / 86_400_000)), "cash_reconciliations", "latest", "/money", { basis: "calculated" })
        : missing("cash_reconciliations", "all-time", "/money", "never counted"),
      hasLiveData: cashHasData,
    },
    cheques: {
      totalReceived: metric(r0(i.cycle.totalReceived), "settlement/cheque-cycle.getChequeCycle", "all-time", "/cheques"),
      openTabGross: metric(r0(i.cycle.openTab.revenue), "settlement/cheque-cycle.getChequeCycle", `since last cheque`, "/settlements", { note: "gross sales awaiting settlement, BEFORE the mall's deductions" }),
      openTabEstimatedNet: i.cycle.blendedDeductionPct == null
        ? missing("settlement/cheque-cycle.getChequeCycle", "since last cheque", "/settlements", "no deduction history to estimate the net")
        : metric(r0(i.cycle.openTab.revenue * (1 - i.cycle.blendedDeductionPct / 100)), "settlement/cheque-cycle.getChequeCycle", "since last cheque", "/settlements", { basis: "estimated", confidence: "medium" }),
      blendedDeductionPct: i.cycle.blendedDeductionPct == null
        ? missing("settlement/cheque-cycle.getChequeCycle", "all-time", "/settlements", "no cheques with known coverage")
        : metric(r1(i.cycle.blendedDeductionPct), "settlement/cheque-cycle.getChequeCycle", "all-time", "/settlements", { basis: "calculated" }),
      overduePeriods: metric(overdue, "read/settlements.getSettlementStatements", "all-time", "/settlements", { note: "expected > 0, no cheque, period ended >45 days ago" }),
      unmatchedCheques: metric(i.statements.filter((s) => s.chequeReceived != null && s.difference != null && Math.abs(s.difference) > Math.max(5, 0.005 * s.revenue)).length, "read/settlements.getSettlementStatements", "all-time", "/settlements", { basis: "calculated" }),
      averageDelayDays: (() => {
        const lags = received.filter((s) => s.end != null).map((s) => {
          const chq = i.cycle.cheques.find((c) => c.coverTo != null && s.end != null && c.coverTo >= s.end);
          return chq ? Math.round((Date.parse(chq.date) - Date.parse(s.end!)) / 86_400_000) : null;
        }).filter((n): n is number => n != null && n >= 0);
        return lags.length
          ? metric(r0(lags.reduce((s, n) => s + n, 0) / lags.length), "read/settlements + cheque-cycle", "all-time", "/settlements", { basis: "calculated", confidence: "medium" })
          : missing("read/settlements", "all-time", "/settlements", "not enough matched period→cheque pairs");
      })(),
      lastChequeDate: lastCheque
        ? metric(lastCheque.date, "settlement/cheque-cycle.getChequeCycle", "latest", "/cheques")
        : missing("cheques", "all-time", "/cheques", "no cheques recorded"),
      interChequeGapDays: (() => {
        const dates = i.cycle.cheques.map((c) => c.date).sort();
        if (dates.length < 4) return missing("cheques", "all-time", "/cheques", "not enough cheques to establish the rhythm");
        const gaps = dates.slice(1).map((d, k) => Math.round((Date.parse(d) - Date.parse(dates[k])) / 86_400_000)).filter((g) => g > 0).sort((a, b) => a - b);
        return metric(gaps[Math.floor(gaps.length / 2)], "cheques (median gap)", "all-time", "/cheques", { basis: "calculated", confidence: "medium" });
      })(),
      nextChequeEta: (() => {
        const dates = i.cycle.cheques.map((c) => c.date).sort();
        if (dates.length < 4 || !lastCheque) return missing("cheques", "all-time", "/cheques", "cannot estimate without a cheque rhythm");
        const gaps = dates.slice(1).map((d, k) => Math.round((Date.parse(d) - Date.parse(dates[k])) / 86_400_000)).filter((g) => g > 0).sort((a, b) => a - b);
        const gap = gaps[Math.floor(gaps.length / 2)];
        const eta = new Date(Date.parse(lastCheque.date) + gap * 86_400_000).toISOString().slice(0, 10);
        return metric(eta, "cheques (last + median gap)", "estimate", "/cheques", { basis: "estimated", confidence: "medium", note: "the mall pays on its own schedule — this is the historical rhythm, not a promise" });
      })(),
      monthlyRentDeduction: (() => {
        const rents = i.statements.filter((st) => st.rent > 0).slice(0, 3).map((st) => st.rent);
        return rents.length
          ? metric(r0(rents.reduce((a, b) => a + b, 0) / rents.length), "read/settlements (recent periods)", "monthly", "/settlements", { note: "DEDUCTED from the settlement cheque by the mall — never a cash outflow" })
          : missing("settlement_deductions", "monthly", "/settlements", "no rent deductions recorded");
      })(),
    },
    dataQuality: {
      issues: dq,
      missingCostLines: metric(i.profitPeriod.missingCostLines, PROFIT, P, "/costs"),
      uncoveredRevenueAllTime: metric(r0(i.profitPeriod.uncoveredRevenue), PROFIT, P, "/reconcile"),
      lineCoverageWindow: metric("2024-11-01→2025-06-30", "sale_items coverage", "all-time", "/sales/product-lines", { note: "product-line detail exists inside this window; later months are day-totals only" }),
      unknownProductCodes: metric([], "importer logs", "latest run", "/sales/product-lines", { note: "see COMPLETION_BOARD for the current unknown-code list" }),
      missingOwnerInputs: [
        ...(i.ownerAnswers ? [] : ["strategy targets (grouped questions sent 2026-07-13 — using documented defaults)"]),
        ...(i.latestCashCount ? [] : ["first cash drawer count"]),
        ...(stockHasData ? [] : ["first physical stock count"]),
        ...(staleDays != null && staleDays > 3 ? [`daily sales after ${lastDataDate}`] : []),
      ],
    },
    context: composeContext(i.ownerAnswers, P),
  };
}

/* ── I/O assembler ────────────────────────────────────────────────────── */

async function getLatestCashCount(): Promise<SnapshotInputs["latestCashCount"]> {
  const { data, error } = await requireEngine()
    .from("cash_reconciliations").select("count_date,counted_amount,expected_balance")
    .order("count_date", { ascending: false }).limit(1);
  if (error) throw error;
  const r = data?.[0];
  return r ? { date: r.count_date, counted: r.counted_amount, expected: r.expected_balance } : null;
}

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** Default periods: latest ACTIVE month in the books vs the previous active
 *  month (sales data can lag the calendar — comparing against an empty
 *  calendar month would fabricate a collapse). */
export function defaultPeriods(daily: DayPoint[], today: string): { period: { from: string; to: string }; compare: { from: string; to: string } } {
  const months = [...new Set(daily.filter((d) => d.total > 0).map((d) => d.date.slice(0, 7)))].sort();
  const cur = months[months.length - 1] ?? today.slice(0, 7);
  const prev = months[months.length - 2] ?? cur;
  return { period: monthBounds(cur), compare: monthBounds(prev) };
}

export async function assembleSnapshotV2(): Promise<StrategistSnapshot> {
  const today = todayCairo();
  const daily = await getDailyRevenue({ from: "2024-01-01", to: today });
  const { period, compare } = defaultPeriods(daily, today);

  const months = [...new Set(daily.filter((d) => d.total > 0).map((d) => d.date.slice(0, 7)))].sort().slice(-6);
  const [profitPeriod, profitCompare, productsPeriod, productsCompare, stock, cashPos, cashSummary, latestCashCount, cycle, statements, expenseTrends, missingData, ownerAnswers, ...profitMonthReadouts] = await Promise.all([
    getProfitReadout(period),
    getProfitReadout(compare),
    getProductProfit(period),
    getProductProfit(compare),
    getStockSummary(),
    getCashPosition(),
    getCashSummary(period),
    getLatestCashCount(),
    getChequeCycle(),
    getSettlementStatements(),
    getExpenseCategoryTrends(period, compare),
    getMissingData(),
    loadOwnerContext(),
    ...months.map((m) => getProfitReadout(monthBounds(m))),
  ] as const);

  return composeSnapshotV2({
    today, daily, period, compare,
    profitPeriod, profitCompare,
    profitMonths: months.map((m, idx) => ({ month: m, readout: profitMonthReadouts[idx] })),
    productsPeriod, productsCompare,
    stock, cashPos, cashSummary, latestCashCount, cycle, statements,
    expenseTrends, missingData, ownerAnswers,
  });
}
