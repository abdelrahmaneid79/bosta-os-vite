/** Sales read-model. Revenue is canonical: Σ sales.total_amount where
 *  voided_at is null. sale_items are breakdown/COGS only — never summed into
 *  revenue. Reconciliation tolerance = max(5, 0.5% * total). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import type { Tables } from "@/core/db/tables";
import { fetchAllRows, type DateRange } from "./common";

export const reconTolerance = (total: number) => Math.max(5, 0.005 * total);

export interface DailyRevenuePoint {
  date: string;
  total: number;
}

export async function getDailyRevenue(range: DateRange): Promise<DailyRevenuePoint[]> {
  // Paged: one row per trading day crosses PostgREST's silent 1000-row cap
  // after ~3 years of history — un-paged this would quietly drop revenue.
  const data = await fetchAllRows((a, b) =>
    requireEngine()
      .from("sales")
      .select("sale_date,total_amount")
      .is("voided_at", null)
      .gte("sale_date", range.from)
      .lte("sale_date", range.to)
      .range(a, b),
  );
  const byDay = new Map<string, number>();
  for (const r of data) byDay.set(r.sale_date, (byDay.get(r.sale_date) ?? 0) + r.total_amount);
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, total }));
}

export async function getRevenueTotal(range: DateRange): Promise<number> {
  const points = await getDailyRevenue(range);
  return points.reduce((s, p) => s + p.total, 0);
}

export interface SaleRow {
  id: string;
  date: string;
  total: number;
  payment: Tables<"sales">["payment_method"];
  source: Tables<"sales">["source_type"];
  reconciled: boolean;
  hasLines: boolean; // day has at least one product line item
}

/** Completeness signal for a sale day:
 *   green  = total AND product lines that reconcile to it (full detail)
 *   yellow = day total only, no product lines captured yet
 *   red    = has product lines that DON'T reconcile to the total (needs a look) */
export type DaySignal = "green" | "yellow" | "red";
export function daySignal(r: { reconciled: boolean; hasLines: boolean }): DaySignal {
  if (!r.reconciled) return "red";        // lines present but they don't sum to the total
  return r.hasLines ? "green" : "yellow"; // reconciled: green with lines, yellow (total only) without
}
export const DAY_SIGNAL_LABEL: Record<DaySignal, string> = {
  green: "Complete — total + product lines",
  yellow: "Day total only — no product breakdown yet",
  red: "Product lines don't reconcile to the total",
};

export async function getRecentSales(limit = 60, range?: DateRange): Promise<SaleRow[]> {
  let q = requireEngine()
    .from("sales")
    // sale_items(count) is an aggregate embed — one extra count per day, no row-cap issues
    .select("id,sale_date,total_amount,payment_method,source_type,reconciled,sale_items(count)")
    .is("voided_at", null);
  if (range) q = q.gte("sale_date", range.from).lte("sale_date", range.to);
  const { data, error } = await q.order("sale_date", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as unknown as (Record<string, unknown> & { sale_items?: { count: number }[] })[]).map((r) => ({
    id: r.id as string,
    date: r.sale_date as string,
    total: r.total_amount as number,
    payment: r.payment_method as SaleRow["payment"],
    source: r.source_type as SaleRow["source"],
    reconciled: r.reconciled as boolean,
    hasLines: (r.sale_items?.[0]?.count ?? 0) > 0,
  }));
}

export interface SaleLine {
  id: string; productId: string | null; name: string;
  qty: number; unitPrice: number | null; lineTotal: number;
  cogs: number | null; hasCogs: boolean;
}
export async function getSaleItems(saleId: string): Promise<SaleLine[]> {
  const sb = requireEngine();
  const [{ data, error }, products] = await Promise.all([
    sb.from("sale_items").select("id,product_id,raw_product_name,quantity,unit_price,line_total,cogs_at_sale")
      .eq("sale_id", saleId).is("voided_at", null).order("created_at"),
    sb.from("products").select("id,name_en"),
  ]);
  if (error) throw error;
  const names = new Map((products.data ?? []).map((p) => [p.id, p.name_en]));
  return data.map((r) => ({
    id: r.id, productId: r.product_id,
    name: r.product_id ? (names.get(r.product_id) ?? "Unknown") : (r.raw_product_name || "Unmapped"),
    qty: Number(r.quantity), unitPrice: r.unit_price, lineTotal: Number(r.line_total),
    cogs: r.cogs_at_sale, hasCogs: r.cogs_at_sale != null,
  }));
}

export async function getSalesStats(range: DateRange) {
  const { data, error } = await requireEngine()
    .from("sales")
    .select("total_amount,reconciled")
    .is("voided_at", null)
    .gte("sale_date", range.from)
    .lte("sale_date", range.to);
  if (error) throw error;
  const total = data.reduce((s, r) => s + r.total_amount, 0);
  const unreconciled = data.filter((r) => !r.reconciled).length;
  return { total, days: data.length, unreconciled };
}
