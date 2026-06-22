/** Product profitability read-model. For each product, over a date range:
 *  units sold, revenue (Σ line_total), COGS (Σ cogs_at_sale), gross profit and
 *  margin — aggregated from non-voided sale_items of non-voided sales. Margin is
 *  withheld (null) for a product when ANY of its sold lines lacks a recorded
 *  cost, so we never publish a wrong per-product number. READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import type { DateRange } from "./common";

export interface ProductProfit {
  productId: string;
  name: string;
  units: number;
  revenue: number;
  cogs: number;
  grossProfit: number | null; // null when any line lacks cost
  margin: number | null;       // % of revenue; null when incomplete
  lines: number;
  missingCostLines: number;
}

/** Pure aggregation — groups raw sold lines by product and composes profit.
 *  Unmapped lines (productId null) are bucketed under a synthetic "unmapped" id
 *  so their revenue is still visible but never gates another product's margin. */
export function aggregateProductProfit(
  lines: { productId: string | null; name: string; qty: number; lineTotal: number; cogs: number | null }[],
): ProductProfit[] {
  const map = new Map<string, ProductProfit & { _complete: boolean }>();
  for (const l of lines) {
    const id = l.productId ?? "__unmapped__";
    let p = map.get(id);
    if (!p) {
      p = { productId: id, name: l.name, units: 0, revenue: 0, cogs: 0, grossProfit: 0, margin: null, lines: 0, missingCostLines: 0, _complete: true };
      map.set(id, p);
    }
    p.units += l.qty;
    p.revenue += l.lineTotal;
    p.lines += 1;
    if (l.cogs == null) { p.missingCostLines += 1; p._complete = false; }
    else p.cogs += l.cogs;
  }
  const out: ProductProfit[] = [];
  for (const p of map.values()) {
    const complete = p._complete && p.lines > 0 && p.productId !== "__unmapped__";
    const grossProfit = complete ? p.revenue - p.cogs : null;
    out.push({
      productId: p.productId, name: p.name, units: p.units, revenue: p.revenue, cogs: p.cogs,
      grossProfit,
      margin: grossProfit == null || p.revenue <= 0 ? null : (grossProfit / p.revenue) * 100,
      lines: p.lines, missingCostLines: p.missingCostLines,
    });
  }
  // Best earners first; products with withheld profit sink below known ones.
  return out.sort((a, b) => (b.grossProfit ?? -Infinity) - (a.grossProfit ?? -Infinity) || b.revenue - a.revenue);
}

export async function getProductProfit(range: DateRange): Promise<ProductProfit[]> {
  const sb = requireEngine();
  const sales = await sb.from("sales").select("id").is("voided_at", null)
    .gte("sale_date", range.from).lte("sale_date", range.to);
  if (sales.error) throw sales.error;
  const saleIds = sales.data.map((s) => s.id);
  if (saleIds.length === 0) return [];

  const [{ data, error }, products] = await Promise.all([
    sb.from("sale_items").select("product_id,raw_product_name,quantity,line_total,cogs_at_sale")
      .is("voided_at", null).in("sale_id", saleIds),
    sb.from("products").select("id,name_en"),
  ]);
  if (error) throw error;
  const names = new Map((products.data ?? []).map((p) => [p.id, p.name_en]));
  return aggregateProductProfit(
    data.map((r) => ({
      productId: r.product_id,
      name: r.product_id ? (names.get(r.product_id) ?? "Unknown") : (r.raw_product_name || "Unmapped"),
      qty: Number(r.quantity), lineTotal: Number(r.line_total), cogs: r.cogs_at_sale,
    })),
  );
}
