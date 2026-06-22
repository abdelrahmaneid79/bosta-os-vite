/** Analytics engine — turns the raw ledgers into the series and KPIs that power
 *  the charts. The aggregations are PURE (unit-tested); getAnalytics does the I/O
 *  once (a single wide daily-revenue read, filtered in memory) then composes the
 *  bundle the Reports/Overview screen renders. READ-ONLY. */
import { getDailyRevenue } from "./sales";
import { getExpenses, getExpenseTotal } from "./expenses";
import { getPurchases } from "./purchases";
import { getProductProfit } from "./products";
import { getProfitReadout } from "./profit";
import { getSettlementPeriods } from "./settlements";
import { todayCairo, monthBoundsCairo, priorRange, isoRange } from "@/core/time";
import type { DateRange } from "./common";

export interface DailyPoint { date: string; total: number }
export interface Series { label: string; value: number }

const EPOCH = "2000-01-01";
export const monthKey = (iso: string) => iso.slice(0, 7);
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

export function inRange(points: DailyPoint[], r: DateRange): DailyPoint[] {
  return points.filter((p) => p.date >= r.from && p.date <= r.to);
}
export function sumTotals(points: DailyPoint[]): number {
  return points.reduce((s, p) => s + p.total, 0);
}
export function bucketByMonth(points: DailyPoint[]): Series[] {
  const m = new Map<string, number>();
  for (const p of points) m.set(monthKey(p.date), (m.get(monthKey(p.date)) ?? 0) + p.total);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
}
export function dayOfWeekAverages(points: DailyPoint[]): Series[] {
  const sum = Array(7).fill(0), cnt = Array(7).fill(0);
  for (const p of points) { const w = weekday(p.date); sum[w] += p.total; cnt[w] += 1; }
  return DOW.map((label, i) => ({ label, value: cnt[i] ? sum[i] / cnt[i] : 0 }));
}
export function rollingAverage(points: DailyPoint[], window = 7): Series[] {
  const s = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: Series[] = [];
  for (let i = 0; i < s.length; i++) {
    const start = Math.max(0, i - window + 1);
    let acc = 0; for (let j = start; j <= i; j++) acc += s[j].total;
    out.push({ label: s[i].date, value: acc / (i - start + 1) });
  }
  return out;
}
export function topDays(points: DailyPoint[], n = 10): DailyPoint[] {
  return [...points].filter((p) => p.total > 0).sort((a, b) => b.total - a.total).slice(0, n);
}
export function lastNDaysAvg(points: DailyPoint[], today: string, n: number): number {
  const cutoff = isoDaysAgoLocal(today, n - 1);
  const win = points.filter((p) => p.date >= cutoff && p.date <= today);
  return win.length ? sumTotals(win) / n : 0;
}
function isoDaysAgoLocal(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}

export interface Kpi { key: string; label: string; value: number | null; sub: string; tone?: "good" | "warn" | "muted" }

export interface AnalyticsBundle {
  kpis: Kpi[];
  daily: Series[];            // revenue per day in range (label MM-DD)
  monthlyRevenue: Series[];
  monthlyPurchases: Series[];
  expenseDistribution: { label: string; value: number }[];
  dayOfWeek: Series[];
  rolling: Series[];          // last 90 days, 7-day rolling avg
  topRevenueDays: DailyPoint[];
  productsByRevenue: { label: string; value: number }[];
  productsByVolume: { label: string; value: number }[];
  rangeLabel: string;
}

export async function getAnalytics(range: DateRange): Promise<AnalyticsBundle> {
  const today = todayCairo();
  const month = monthBoundsCairo();
  const prior = priorRange(range);

  const [allPoints, expensesRange, totalExpensesAll, purchasesRange, products, monthProfit, periods] = await Promise.all([
    getDailyRevenue({ from: EPOCH, to: today }),
    getExpenses(range),
    getExpenseTotal({ from: EPOCH, to: today }),
    getPurchases(range),
    getProductProfit(range),
    getProfitReadout(month),
    getSettlementPeriods(),
  ]);

  const rangePoints = inRange(allPoints, range);
  const priorRevenue = sumTotals(inRange(allPoints, prior));
  const periodRevenue = sumTotals(rangePoints);
  const firstDate = allPoints.length ? allPoints.map((p) => p.date).sort()[0] : today;
  const daysSinceLaunch = Math.max(1, isoRange(firstDate, today).length);
  const owed = periods.filter((p) => p.status === "open").reduce((s, p) => s + p.netExpected, 0);

  // expense distribution by category
  const catMap = new Map<string, number>();
  for (const e of expensesRange) catMap.set(e.category, (catMap.get(e.category) ?? 0) + e.amount);
  const expenseDistribution = [...catMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  // monthly purchases
  const purMonth = new Map<string, number>();
  for (const p of purchasesRange) purMonth.set(monthKey(p.date), (purMonth.get(monthKey(p.date)) ?? 0) + p.totalCost);
  const monthlyPurchases = [...purMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));

  const growth = priorRevenue > 0 ? ((periodRevenue - priorRevenue) / priorRevenue) * 100 : null;

  const kpis: Kpi[] = [
    { key: "periodRevenue", label: "Period revenue", value: periodRevenue, sub: `${rangePoints.length} sales days` },
    { key: "dailyAvg", label: "Daily average", value: rangePoints.length ? periodRevenue / rangePoints.length : 0, sub: "this period" },
    { key: "avg30", label: "30-day average", value: lastNDaysAvg(allPoints, today, 30), sub: "rolling benchmark" },
    { key: "monthProfit", label: "Est. monthly profit", value: monthProfit.netProfit, sub: monthProfit.netProfit == null ? "needs product costs" : "this month, net", tone: "good" },
    { key: "owed", label: "Expected payout", value: owed, sub: "open settlements", tone: "warn" },
    { key: "allTime", label: "All-time revenue", value: sumTotals(allPoints), sub: `${firstDate} → today` },
    { key: "totalDays", label: "Days traded", value: allPoints.length, sub: "since launch" },
    { key: "totalExp", label: "Total expenses", value: totalExpensesAll, sub: "all recorded" },
    { key: "growth", label: "Growth vs prev", value: growth, sub: growth == null ? "no prior data" : "vs previous period", tone: growth != null && growth < 0 ? "warn" : "good" },
    { key: "sinceLaunch", label: "Days since launch", value: daysSinceLaunch, sub: firstDate },
  ];

  return {
    kpis,
    daily: rangePoints.map((p) => ({ label: p.date.slice(5), value: p.total })),
    monthlyRevenue: bucketByMonth(rangePoints),
    monthlyPurchases,
    expenseDistribution,
    dayOfWeek: dayOfWeekAverages(rangePoints),
    rolling: rollingAverage(inRange(allPoints, { from: isoDaysAgoLocal(today, 89), to: today }), 7).map((s) => ({ label: s.label.slice(5), value: s.value })),
    topRevenueDays: topDays(rangePoints, 10),
    productsByRevenue: products.slice().sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((p) => ({ label: p.name, value: p.revenue })),
    productsByVolume: products.slice().sort((a, b) => b.units - a.units).slice(0, 10).map((p) => ({ label: p.name, value: p.units })),
    rangeLabel: `${range.from} → ${range.to}`,
  };
}
