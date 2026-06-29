/** Command-center read-model — the owner's "what's happening / what needs me"
 *  snapshot, from live reads only. READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { todayCairo, monthBoundsCairo } from "@/core/time";
import { getRevenueTotal } from "./sales";
import { getStockSummary } from "./stock";
import { getCashPosition } from "./money";
import { getChequeCycle } from "./settlements";

export interface CommandCenter {
  todayRevenue: number;
  monthRevenue: number;
  stockValue: number;
  cashBalance: number | null;
  owed: number;            // open tab: sales accumulated since the last cheque
  warnings: { missingCogs: number; unreconciledSales: number; negativeStock: number };
}

export async function getCommandCenter(): Promise<CommandCenter> {
  const sb = requireEngine();
  const today = todayCairo();
  const month = monthBoundsCairo();

  const [todayRevenue, monthRevenue, stock, cash, cycle, todayRows, unrecRows] = await Promise.all([
    getRevenueTotal({ from: today, to: today }),
    getRevenueTotal(month),
    getStockSummary(),
    getCashPosition(),
    getChequeCycle(),
    sb.from("sales").select("id").is("voided_at", null).eq("sale_date", today),
    sb.from("sales").select("id").is("voided_at", null).eq("reconciled", false)
      .gte("sale_date", month.from).lte("sale_date", month.to),
  ]);
  if (todayRows.error) throw todayRows.error;
  if (unrecRows.error) throw unrecRows.error;

  return {
    todayRevenue,
    monthRevenue,
    stockValue: stock.totalValue,
    cashBalance: cash.onHand,
    owed: cycle.openTab.revenue,
    warnings: {
      missingCogs: stock.missingCostCount,
      unreconciledSales: unrecRows.data.length,
      negativeStock: stock.negativeCount,
    },
  };
}
