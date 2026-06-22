/** Risk-insight aggregator — gathers live read-model data and feeds it to the
 *  PURE builders in core/insights/risk.ts. This file does the I/O; the math and
 *  judgement live in the pure module (unit-tested). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { todayCairo, monthBoundsCairo, lastMonthBoundsCairo, isoDaysAgo } from "@/core/time";
import { getStockSummary } from "./stock";
import { getCashSummary } from "./money";
import { getSettlementPeriods, getCheques } from "./settlements";
import { getRevenueTotal, reconTolerance } from "./sales";
import { getExpenseTotal } from "./expenses";
import {
  buildStockInsights, buildCashInsights, buildSettlementInsights, buildTrendInsights,
  sortInsights, type Insight, type Velocity,
} from "@/core/insights/risk";

/** Units sold per product per day over the trailing window, from non-voided
 *  sale lines of non-voided sales. daysObserved spans the earliest observed
 *  sale to today so a thin history isn't projected as if it were a full month. */
export async function getStockVelocity(windowDays = 30): Promise<Map<string, Velocity>> {
  const sb = requireEngine();
  const today = todayCairo();
  const from = isoDaysAgo(today, windowDays - 1);
  const sales = await sb.from("sales").select("id,sale_date").is("voided_at", null)
    .gte("sale_date", from).lte("sale_date", today);
  if (sales.error) throw sales.error;
  const out = new Map<string, Velocity>();
  if (sales.data.length === 0) return out;
  const saleIds = sales.data.map((s) => s.id);
  const earliest = sales.data.reduce((m, s) => (s.sale_date < m ? s.sale_date : m), today);
  const daysObserved = Math.max(1, daysBetween(earliest, today) + 1);

  const items = await sb.from("sale_items").select("product_id,quantity")
    .is("voided_at", null).in("sale_id", saleIds);
  if (items.error) throw items.error;
  const units = new Map<string, number>();
  for (const r of items.data) {
    if (!r.product_id) continue;
    units.set(r.product_id, (units.get(r.product_id) ?? 0) + Number(r.quantity));
  }
  for (const [id, total] of units) out.set(id, { unitsPerDay: total / daysObserved, daysObserved });
  return out;
}

export async function getRiskInsights(): Promise<Insight[]> {
  const sb = requireEngine();
  const month = monthBoundsCairo();
  const last = lastMonthBoundsCairo();

  const [stock, velocity, cash, counted, periods, cheques, thisRev, lastRev, thisExp, lastExp] =
    await Promise.all([
      getStockSummary(),
      getStockVelocity(30),
      getCashSummary(month),
      sb.from("cash_reconciliations").select("id", { count: "exact", head: true }),
      getSettlementPeriods(),
      getCheques(),
      getRevenueTotal(month),
      getRevenueTotal(last),
      getExpenseTotal(month),
      getExpenseTotal(last),
    ]);

  const chequePeriodIds = new Set(cheques.map((c) => c.periodId));
  const periodsLite = periods.map((p) => ({
    id: p.id, start: p.start, netExpected: p.netExpected, status: p.status,
    hasCheque: chequePeriodIds.has(p.id),
  }));

  return sortInsights([
    ...buildStockInsights(
      stock.positions.map((p) => ({
        id: p.id, nameEn: p.nameEn, baseUnit: p.baseUnit, onHand: p.onHand,
        isNegative: p.isNegative, isLow: p.isLow, hasCost: p.hasCost, active: p.active,
      })),
      velocity,
    ),
    ...buildCashInsights({
      balance: cash.balance, inflow: cash.inflow, outflow: cash.outflow,
      withdrawals: cash.withdrawals, hasEverCounted: (counted.count ?? 0) > 0,
    }),
    ...buildSettlementInsights(periodsLite, cheques.map((c) => ({
      id: c.id, expected: c.expected, received: c.received, difference: c.difference, status: c.status,
    })), reconTolerance),
    ...buildTrendInsights({ thisRevenue: thisRev, lastRevenue: lastRev, thisExpenses: thisExp, lastExpenses: lastExp }),
  ]);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(...iso(fromIso));
  const b = Date.UTC(...iso(toIso));
  return Math.round((b - a) / 86_400_000);
}
function iso(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m - 1, d];
}
