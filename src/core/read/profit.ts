/** Profit read-model — "hides, never lies". Profit is null when ANY mapped sold
 *  line in range has a missing cogs_at_sale. Revenue = Σ sales.total_amount;
 *  COGS = Σ sale_items.cogs_at_sale on non-voided lines of non-voided sales in
 *  range. Operating expenses excluded for now (read-only slice). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { getRevenueTotal } from "./sales";
import type { DateRange } from "./common";

export interface ProfitReadout {
  revenue: number;
  cogs: number;
  grossProfit: number | null; // null when cost data incomplete
  margin: number | null;
  soldLines: number;
  missingCostLines: number;
  complete: boolean;
}

export async function getProfitReadout(range: DateRange): Promise<ProfitReadout> {
  const sb = requireEngine();

  // 1) Non-voided sales in range → their ids.
  const sales = await sb
    .from("sales")
    .select("id")
    .is("voided_at", null)
    .gte("sale_date", range.from)
    .lte("sale_date", range.to);
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

  const revenue = await getRevenueTotal(range);
  const complete = lines > 0 && missing === 0;
  const grossProfit = complete ? revenue - cogs : null;
  return {
    revenue,
    cogs,
    grossProfit,
    margin: grossProfit == null || revenue <= 0 ? null : (grossProfit / revenue) * 100,
    soldLines: lines,
    missingCostLines: missing,
    complete,
  };
}
