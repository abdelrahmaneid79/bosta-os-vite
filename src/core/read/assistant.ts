/** Builds the Ask-Bosta context from the read-models — one place that gathers
 *  the numbers the assistant can answer about. READ-ONLY. */
import { getDailyRevenue } from "./sales";
import { getProfitReadout } from "./profit";
import { getExpenseTotal } from "./expenses";
import { getMoneyAccounts } from "./money";
import { getSettlementPeriods } from "./settlements";
import { getProductProfit } from "./products";
import { getStockSummary } from "./stock";
import { getStockVelocity } from "./insights";
import { todayCairo, monthBoundsCairo, lastMonthBoundsCairo, isoDaysAgo } from "@/core/time";
import type { BostaContext } from "@/core/assistant/askBosta";

const EPOCH = "2000-01-01";

export async function getAssistantContext(): Promise<BostaContext> {
  const today = todayCairo();
  const yesterday = isoDaysAgo(today, 1);
  const month = monthBoundsCairo();
  const last = lastMonthBoundsCairo();
  const weekFrom = isoDaysAgo(today, 6);

  const [all, profit, expM, expL, accts, periods, prods, stock, velocity] = await Promise.all([
    getDailyRevenue({ from: EPOCH, to: today }),
    getProfitReadout(month),
    getExpenseTotal(month),
    getExpenseTotal(last),
    getMoneyAccounts(),
    getSettlementPeriods(),
    getProductProfit(month),
    getStockSummary(),
    getStockVelocity(30),
  ]);

  const sum = (from: string, to: string) => all.filter((p) => p.date >= from && p.date <= to).reduce((s, p) => s + p.total, 0);
  const bestDay = all.length ? all.reduce((m, p) => (p.total > m.total ? p : m)) : null;
  const byRevenue = prods.slice().sort((a, b) => b.revenue - a.revenue);
  const low = stock.positions
    .filter((p) => p.active && (p.isNegative || p.isLow || p.onHand <= 0))
    .map((p) => ({ name: p.nameEn, onHand: p.onHand, unit: p.baseUnit }));

  // soonest stock-out from velocity (smallest positive days-of-cover)
  let soonest: { name: string; days: number } | null = null;
  for (const p of stock.positions) {
    if (!p.active || p.onHand <= 0) continue;
    const v = velocity.get(p.id);
    if (!v || v.unitsPerDay <= 0 || v.daysObserved < 7) continue;
    const days = p.onHand / v.unitsPerDay;
    if (soonest == null || days < soonest.days) soonest = { name: p.nameEn, days };
  }

  // is yesterday the best day of THIS month?
  const monthPoints = all.filter((p) => p.date >= month.from && p.date <= month.to);
  const monthBest = monthPoints.length ? monthPoints.reduce((m, p) => (p.total > m.total ? p : m)) : null;
  const monthRevenue = sum(month.from, month.to);

  return {
    revenue: {
      today: sum(today, today),
      week: sum(weekFrom, today),
      month: monthRevenue,
      lastMonth: sum(last.from, last.to),
      all: all.reduce((s, p) => s + p.total, 0),
    },
    profitMonthNet: profit.netProfit,
    marginMonth: profit.netMargin,
    expensesMonth: expM,
    expensesLastMonth: expL,
    cash: accts[0]?.balance ?? null,
    owed: periods.filter((p) => p.status === "open").reduce((s, p) => s + p.netExpected, 0),
    rentMonthly: null,
    topProduct: byRevenue[0] ? { name: byRevenue[0].name, revenue: byRevenue[0].revenue } : null,
    bestDay: bestDay ? { date: bestDay.date, total: bestDay.total } : null,
    lowStock: low,
    yesterdayRevenue: sum(yesterday, yesterday),
    avgDailyMonth: monthPoints.length ? monthRevenue / monthPoints.length : 0,
    soonestStockout: soonest,
    isYesterdayBest: !!monthBest && monthBest.date === yesterday && monthBest.total > 0,
  };
}
