/** Product deep-dive read-model — everything about one product over a range:
 *  live stock position, period KPIs (units sold, revenue, COGS, gross profit
 *  withheld when a line lacks cost), velocity & days-of-cover, plus its sale
 *  lines and purchase batches. READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { isoRange } from "@/core/time";
import type { DateRange } from "./common";

export interface ProductSaleLine { saleId: string; date: string; qty: number; unitPrice: number | null; lineTotal: number; cogs: number | null; hasCogs: boolean }
export interface ProductPurchase { id: string; date: string; qty: number; unitCost: number; totalCost: number }

export interface ProductDetail {
  id: string;
  nameEn: string;
  nameAr: string | null;
  baseUnit: string;
  saleUnit: string | null;
  sellingPrice: number | null;
  active: boolean;
  lowStockThreshold: number | null;
  // live position
  onHand: number;
  avgCost: number;
  stockValue: number;
  hasCost: boolean;
  isLow: boolean;
  isNegative: boolean;
  // period KPIs
  unitsSold: number;
  revenue: number;
  cogs: number;
  grossProfit: number | null; // null when any sold line lacks cost
  margin: number | null;
  missingCostLines: number;
  purchaseQty: number;
  purchaseCost: number;
  // projection
  unitsPerDay: number | null;
  daysCover: number | null;   // onHand / unitsPerDay, null when no velocity
  // detail lists
  saleLines: ProductSaleLine[];
  purchases: ProductPurchase[];
}

export async function getProductDetail(productId: string, range: DateRange): Promise<ProductDetail> {
  const sb = requireEngine();
  const prod = await sb.from("products")
    .select("id,name_en,name_ar,base_unit,sale_unit,selling_price,active,low_stock_threshold,current_stock,avg_cost")
    .eq("id", productId).single();
  if (prod.error) throw prod.error;
  const p = prod.data;

  const sales = await sb.from("sales").select("id,sale_date").is("voided_at", null)
    .gte("sale_date", range.from).lte("sale_date", range.to);
  if (sales.error) throw sales.error;
  const dateById = new Map(sales.data.map((s) => [s.id, s.sale_date]));
  const saleIds = sales.data.map((s) => s.id);

  const lines: ProductSaleLine[] = [];
  if (saleIds.length) {
    const items = await sb.from("sale_items").select("sale_id,quantity,unit_price,line_total,cogs_at_sale")
      .eq("product_id", productId).is("voided_at", null).in("sale_id", saleIds);
    if (items.error) throw items.error;
    for (const r of items.data) {
      lines.push({
        saleId: r.sale_id, date: dateById.get(r.sale_id) ?? "", qty: Number(r.quantity),
        unitPrice: r.unit_price, lineTotal: Number(r.line_total), cogs: r.cogs_at_sale, hasCogs: r.cogs_at_sale != null,
      });
    }
    lines.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  const purch = await sb.from("purchase_batches").select("id,purchase_date,quantity,unit_cost,total_cost")
    .eq("product_id", productId).is("voided_at", null)
    .gte("purchase_date", range.from).lte("purchase_date", range.to)
    .order("purchase_date", { ascending: false });
  if (purch.error) throw purch.error;
  const purchases: ProductPurchase[] = purch.data.map((r) => ({ id: r.id, date: r.purchase_date, qty: Number(r.quantity), unitCost: Number(r.unit_cost), totalCost: Number(r.total_cost) }));

  // KPIs
  const unitsSold = lines.reduce((s, l) => s + l.qty, 0);
  const revenue = lines.reduce((s, l) => s + l.lineTotal, 0);
  const missingCostLines = lines.filter((l) => !l.hasCogs).length;
  const cogs = lines.reduce((s, l) => s + (l.cogs ?? 0), 0);
  const complete = lines.length > 0 && missingCostLines === 0;
  const grossProfit = complete ? revenue - cogs : null;

  // velocity from observed sale span within range
  const onHand = Number(p.current_stock);
  const avgCost = Number(p.avg_cost);
  let unitsPerDay: number | null = null;
  let daysCover: number | null = null;
  if (lines.length) {
    const earliest = lines.reduce((m, l) => (l.date && l.date < m ? l.date : m), range.to);
    const daysObserved = Math.max(1, isoRange(earliest, range.to).length);
    unitsPerDay = unitsSold / daysObserved;
    if (unitsPerDay > 0 && onHand > 0) daysCover = onHand / unitsPerDay;
  }

  return {
    id: p.id, nameEn: p.name_en, nameAr: p.name_ar, baseUnit: p.base_unit, saleUnit: p.sale_unit,
    sellingPrice: p.selling_price, active: p.active, lowStockThreshold: p.low_stock_threshold,
    onHand, avgCost, stockValue: onHand * avgCost, hasCost: avgCost > 0,
    isLow: p.low_stock_threshold != null && onHand <= p.low_stock_threshold, isNegative: onHand < 0,
    unitsSold, revenue, cogs, grossProfit,
    margin: grossProfit == null || revenue <= 0 ? null : (grossProfit / revenue) * 100,
    missingCostLines,
    purchaseQty: purchases.reduce((s, r) => s + r.qty, 0),
    purchaseCost: purchases.reduce((s, r) => s + r.totalCost, 0),
    unitsPerDay, daysCover,
    saleLines: lines, purchases,
  };
}
