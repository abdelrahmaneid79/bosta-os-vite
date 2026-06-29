/** Profit read-model — "hides, never lies". Gross profit is null when ANY mapped
 *  sold line in range has a missing cogs_at_sale. Revenue = Σ sales.total_amount;
 *  COGS = Σ sale_items.cogs_at_sale on non-voided lines of non-voided sales in
 *  range. Net profit = gross − operating expenses (voided expenses excluded;
 *  personal withdrawals are NOT expenses and never appear here). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { getRevenueTotal } from "./sales";
import { getOperatingExpenseTotal } from "./expenses";
import type { DateRange } from "./common";

export interface ProfitReadout {
  revenue: number;
  cogs: number;
  grossProfit: number | null; // null when cost data incomplete
  margin: number | null;       // gross margin %
  operatingExpenses: number;
  netProfit: number | null;    // gross − opex; null when gross is null
  netMargin: number | null;    // net margin %
  soldLines: number;
  missingCostLines: number;
  complete: boolean;
  partialBefore: string | null; // bookkeeping start; data before it is revenue-only
}

/** Pure profit composition — "hides, never lies". Gross/net profit are null when
 *  any mapped sold line lacks a recorded cost, so we never publish a wrong number.
 *  Personal withdrawals are NOT operating expenses and must be excluded upstream. */
export function composeProfit(input: {
  revenue: number; cogs: number; operatingExpenses: number; soldLines: number; missingCostLines: number; partialBefore?: string | null;
}): ProfitReadout {
  const { revenue, cogs, operatingExpenses, soldLines, missingCostLines } = input;
  const complete = soldLines > 0 && missingCostLines === 0;
  const grossProfit = complete ? revenue - cogs : null;
  const netProfit = grossProfit == null ? null : grossProfit - operatingExpenses;
  return {
    revenue, cogs, grossProfit,
    margin: grossProfit == null || revenue <= 0 ? null : (grossProfit / revenue) * 100,
    operatingExpenses, netProfit,
    netMargin: netProfit == null || revenue <= 0 ? null : (netProfit / revenue) * 100,
    soldLines, missingCostLines, complete,
    partialBefore: input.partialBefore ?? null,
  };
}

/** `since` = the bookkeeping start date. Costs before it are incomplete, so the
 *  P&L is computed only from `since` onward (revenue + COGS + expenses all in the
 *  accounted window) and `partialBefore` is set so the UI can flag it. */
export async function getProfitReadout(range: DateRange, since?: string): Promise<ProfitReadout> {
  const sb = requireEngine();
  const partialBefore = since && range.from < since ? since : null;
  const eff: DateRange = { from: partialBefore ?? range.from, to: range.to };

  // 1) Non-voided sales in the accounted window → their ids.
  const sales = await sb
    .from("sales")
    .select("id")
    .is("voided_at", null)
    .gte("sale_date", eff.from)
    .lte("sale_date", eff.to);
  if (sales.error) throw sales.error;
  const saleIds = sales.data.map((s) => s.id);

  let cogs = 0;
  let lines = 0;
  let missing = 0;
  if (saleIds.length > 0) {
    const items = await sb
      .from("sale_items")
      .select("cogs_at_sale,product_id")
      .is("voided_at", null)
      .in("sale_id", saleIds);
    if (items.error) throw items.error;
    for (const r of items.data) {
      if (r.product_id == null) continue; // unmapped lines don't gate COGS completeness
      lines += 1;
      if (r.cogs_at_sale == null) missing += 1;
      else cogs += r.cogs_at_sale;
    }
  }

  const [revenue, operatingExpenses] = await Promise.all([
    getRevenueTotal(eff),
    getOperatingExpenseTotal(eff),
  ]);
  return composeProfit({ revenue, cogs, operatingExpenses, soldLines: lines, missingCostLines: missing, partialBefore });
}
