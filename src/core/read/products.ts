/** Product profitability read-model. For each product, over a date range:
 *  units sold, revenue (Σ line_total), COGS (Σ cogs_at_sale), gross profit and
 *  margin — aggregated from non-voided sale_items of non-voided sales. Margin is
 *  withheld (null) for a product when ANY of its sold lines lacks a recorded
 *  cost, so we never publish a wrong per-product number. READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import type { SearchableProduct } from "@/core/products/match";
import { composeLifetimeProfit, effectiveCost, type CostSource } from "@/core/products/profit";
import type { DateRange } from "./common";

/** Owner cost settings — the roasting-loss + packaging uplift applied to
 *  estimate-source (raw nut/seed) costs. Default 15%. */
export async function getCostUpliftPct(): Promise<number> {
  const { data, error } = await requireEngine().from("app_settings").select("value").eq("key", "cost_settings").maybeSingle();
  if (error) return 15;
  const v = data?.value as { roastingUpliftPct?: number } | null;
  const n = Number(v?.roastingUpliftPct);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

/** Products + their aliases, for the searchable product picker / import matcher. */
export async function getSearchableProducts(): Promise<(SearchableProduct & { active: boolean })[]> {
  const sb = requireEngine();
  const [pRes, aRes] = await Promise.all([
    sb.from("products").select("id,name_en,name_ar,active,market_code").order("name_en"),
    sb.from("product_aliases").select("product_id,alias"),
  ]);
  if (pRes.error) throw pRes.error;
  if (aRes.error) throw aRes.error;
  const aliasByP = new Map<string, string[]>();
  for (const a of aRes.data ?? []) {
    if (!a.product_id || !a.alias) continue;
    const arr = aliasByP.get(a.product_id) ?? []; arr.push(a.alias); aliasByP.set(a.product_id, arr);
  }
  return (pRes.data ?? []).map((p) => ({ id: p.id, nameEn: p.name_en, nameAr: p.name_ar, aliases: aliasByP.get(p.id) ?? [], marketCode: p.market_code, active: p.active }));
}

/** Products with their POS item code, for the vision-direct day-sales importer's
 *  exact code matching. name_ar/name_en come along for the review display. */
export async function getCodedProducts(): Promise<{ id: string; nameEn: string; nameAr: string | null; posCode: string | null; marketCode: string | null }[]> {
  const { data, error } = await requireEngine()
    .from("products").select("id,name_en,name_ar,pos_code,market_code").order("name_en");
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id, nameEn: p.name_en, nameAr: p.name_ar, posCode: p.pos_code, marketCode: p.market_code }));
}

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

/** Lifetime per-product sales captured from the historical POS export (stored in
 *  app_settings.product_lifetime), enriched with per-unit cost backfilled from
 *  supplier bills → real gross profit + margin (cost source flagged, never
 *  faked). Used as the product profitability source until daily sale_items exist. */
export interface LifetimeProduct {
  name: string; barcode: string; units: number; revenue: number;
  unitCost: number | null; costSource: CostSource;
  cogs: number | null; grossProfit: number | null; margin: number | null;
}
interface RawLifetime { name: string; barcode: string; units: number; revenue: number; unitCost?: number | null; costSource?: string }

export async function getLifetimeProducts(): Promise<LifetimeProduct[]> {
  const sb = requireEngine();
  const [lifeRes, uplift] = await Promise.all([
    sb.from("app_settings").select("value").eq("key", "product_lifetime").maybeSingle(),
    getCostUpliftPct(),
  ]);
  if (lifeRes.error) throw lifeRes.error;
  const v = lifeRes.data?.value as { items?: RawLifetime[] } | null;
  const items = Array.isArray(v?.items) ? v!.items! : [];
  return items.map((it) => {
    const src: CostSource = it.costSource === "verified" || it.costSource === "estimate" ? it.costSource : "unknown";
    const eff = effectiveCost(it.unitCost ?? null, src, uplift); // finished-good cost (uplift on estimates)
    const p = composeLifetimeProfit(it.revenue, it.units, eff, src);
    return { name: it.name, barcode: it.barcode, units: it.units, revenue: it.revenue, unitCost: eff, ...p };
  });
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
