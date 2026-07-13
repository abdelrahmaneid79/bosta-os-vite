/** Shared snapshot fixture — a healthy, fully-measured month. Used by the
 *  engine scenario tests, the eval suite, and grounding scripts. NO vitest
 *  imports here (must be loadable outside the test runner). */
import { metric, missing, type Metric, type StrategistSnapshot } from "../contract";
import { composeContext } from "../context";

/* ── fixture builder: a healthy, fully-measured month ─────────────────── */
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> & object : T[K] };

const P = "2026-05-01→2026-05-31";
const C = "2026-04-01→2026-04-30";
const m = <T,>(v: T, note?: string): Metric<T> => metric(v, "test", P, "/x", note ? { note } : {});

export function makeSnapshot(over: DeepPartial<StrategistSnapshot> = {}): StrategistSnapshot {
  const base: StrategistSnapshot = {
    meta: {
      generatedAt: "2026-07-13T00:00:00Z", businessClock: "Africa/Cairo", today: "2026-06-02",
      period: { from: "2026-05-01", to: "2026-05-31", label: P },
      comparePeriod: { from: "2026-04-01", to: "2026-04-30", label: C },
      lastDataDate: "2026-05-31", staleDays: 2, isStale: false, completenessScore: 85,
      liveOps: { startDate: null, confirmedAt: null, basis: "unset", reason: null, lastCloseDate: null },
    },
    revenue: {
      periodRevenue: m(114_000), priorRevenue: m(110_000),
      changePct: metric(3.6, "test", `${C} → ${P}`, "/sales", { basis: "calculated" }),
      rolling7Avg: m(3_700), rolling30Avg: m(3_700),
      bestDays: m([{ date: "2026-05-30", total: 6800 }]),
      weakestDays: m([{ date: "2026-05-12", total: 2100 }]),
      dayOfWeekPattern: m([{ name: "Fri", value: 5200 }]),
      monthlySeries: m([
        { name: "2026-01", value: 118_000 }, { name: "2026-02", value: 109_000 },
        { name: "2026-03", value: 121_000 }, { name: "2026-04", value: 110_000 },
        { name: "2026-05", value: 114_000 },
      ]),
      unusualDays: m([]),
    },
    profit: {
      revenue: m(114_000), coveredRevenue: metric(110_000, "test", P, "/reconcile", { completeness: 96.5 }),
      uncoveredRevenue: m(4_000), knownCogs: m(66_000),
      grossProfit: m(48_000), operatingExpenses: m(21_000), netProfit: metric(27_000, "read/profit.getProfitReadout", P, "/reconcile"),
      grossMarginPct: metric(40, "test", P, "/reconcile", { confidence: "high", completeness: 96.5 }),
      netMarginPct: m(23.7), priorGrossMarginPct: metric(41, "test", C, "/reconcile"),
      monthlyProfitSeries: m([]),
    },
    products: {
      coveragePct: m(96.5),
      detail: metric([
        { name: "سوداني", revenue: 30_000, units: 400, grossProfit: 12_000, marginPct: 40, missingCost: false, cogs: 18_000, daysSold: 26 },
        { name: "كاجو", revenue: 22_000, units: 90, grossProfit: 11_000, marginPct: 50, missingCost: false, cogs: 11_000, daysSold: 20 },
        { name: "بندق", revenue: 15_000, units: 60, grossProfit: 5_250, marginPct: 35, missingCost: false, cogs: 9_750, daysSold: 15 },
        { name: "بونبون", revenue: 8_000, units: 500, grossProfit: 1_600, marginPct: 20, missingCost: false, cogs: 6_400, daysSold: 24 },
      ], "read/products.getProductProfit", P, "/reports", { confidence: "high", completeness: 96.5 }),
      compareDetail: metric([
        { name: "سوداني", revenue: 27_000, units: 360, grossProfit: 10_800, marginPct: 40, missingCost: false, cogs: 16_200, daysSold: 25 },
        { name: "كاجو", revenue: 21_000, units: 86, grossProfit: 10_500, marginPct: 50, missingCost: false, cogs: 10_500, daysSold: 19 },
        { name: "بندق", revenue: 16_000, units: 64, grossProfit: 5_600, marginPct: 35, missingCost: false, cogs: 10_400, daysSold: 16 },
        { name: "بونبون", revenue: 7_500, units: 470, grossProfit: 1_500, marginPct: 20, missingCost: false, cogs: 6_000, daysSold: 23 },
      ], "read/products.getProductProfit", C, "/reports", { confidence: "high", completeness: 95 }),
      periodDays: m(31),
      comparePeriodDays: m(30),
      positions: metric([
        { name: "سوداني", sellingPrice: 75, avgCost: 45, hasCost: true, onHand: 40, isLow: false, vendor: "Nut Man" },
        { name: "كاجو", sellingPrice: 260, avgCost: 130, hasCost: true, onHand: 12, isLow: false, vendor: "Nut Man" },
        { name: "بندق", sellingPrice: 240, avgCost: 156, hasCost: true, onHand: 8, isLow: false, vendor: "Nut Man" },
        { name: "بونبون", sellingPrice: 16, avgCost: 12.8, hasCost: true, onHand: 900, isLow: false, vendor: "Gamy" },
      ], "read/stock.getStockSummary", "now", "/stock", { confidence: "high" }),
      topRevenue: metric([
        { name: "سوداني", revenue: 30_000, units: 400, grossProfit: 12_000, marginPct: 40, missingCost: false },
        { name: "كاجو", revenue: 22_000, units: 90, grossProfit: 11_000, marginPct: 50, missingCost: false },
      ], "test", P, "/reports", { confidence: "high" }),
      topGrossProfit: m([]), highestMargin: m([]),
      fastestGrowing: m([]), fastestDeclining: m([]),
      highVolumeLowMargin: m([]), lowVolumeHighMargin: m([]),
      missingCosts: m([] as string[]),
      stockRisk: m([] as { name: string; daysCover: number | null; onHand: number }[]),
    },
    inventory: {
      trackedProducts: m(56), stockValue: m(80_000), negativeStock: m(0), lowStock: m(0),
      hasLiveData: true, lastPhysicalCount: m("2026-05-20"),
    },
    expenses: {
      operatingTotal: m(21_000), priorOperatingTotal: m(20_000),
      categories: m([]), spikes: m([] as { name: string; value: number; changePct: number }[]),
      recurringMonthly: m([
        { name: "Salary", avgMonthly: 5_700, isOperating: true },
        { name: "Inventory purchases", avgMonthly: 20_000, isOperating: false },
      ]),
      withdrawals: metric(5_000, "test", P, "/money", { note: "NEVER part of operating expenses" }),
    },
    cash: {
      expectedBalance: metric(60_000, "read/money.getCashPosition", "now", "/money"), latestCount: m(59_500), unexplainedDifference: m(-500),
      inflows: m(120_000), outflows: m(70_000), withdrawals: m(5_000),
      injections: missing("test", P, "/money", "none recorded"),
      lastCountDate: m("2026-05-30"), countAgeDays: m(3), hasLiveData: true,
    },
    cheques: {
      totalReceived: m(2_594_202), openTabGross: m(95_000), openTabEstimatedNet: m(78_000),
      blendedDeductionPct: m(17.5), overduePeriods: m([] as string[]), unmatchedCheques: m(0),
      averageDelayDays: m(38), lastChequeDate: m("2026-05-15"),
      interChequeGapDays: m(31), nextChequeEta: m("2026-06-15"),
      monthlyRentDeduction: metric(15_000, "read/settlements", "monthly", "/settlements", { note: "DEDUCTED from the settlement cheque by the mall — never a cash outflow" }),
    },
    dataQuality: {
      issues: [], missingCostLines: m(0), uncoveredRevenueAllTime: m(4_000),
      lineCoverageWindow: m("2024-11-01→2025-06-30"), unknownProductCodes: m([] as string[]),
      missingOwnerInputs: [],
    },
    context: composeContext(null, P),
  };
  // shallow-merge per block (fixtures override whole metrics)
  const out = { ...base } as StrategistSnapshot & Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    out[k] = { ...(base as never as Record<string, object>)[k], ...(v as object) };
  }
  return out as StrategistSnapshot;
}

