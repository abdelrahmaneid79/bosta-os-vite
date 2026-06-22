/** Sales read-model. Revenue is canonical: Σ sales.total_amount where
 *  voided_at is null. sale_items are breakdown/COGS only — never summed into
 *  revenue. Reconciliation tolerance = max(5, 0.5% * total). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import type { Tables } from "@/core/db/tables";
import type { DateRange } from "./common";

export const reconTolerance = (total: number) => Math.max(5, 0.005 * total);

export interface DailyRevenuePoint {
  date: string;
  total: number;
}

export async function getDailyRevenue(range: DateRange): Promise<DailyRevenuePoint[]> {
  const { data, error } = await requireEngine()
    .from("sales")
    .select("sale_date,total_amount")
    .is("voided_at", null)
    .gte("sale_date", range.from)
    .lte("sale_date", range.to);
  if (error) throw error;
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
}

export async function getRecentSales(limit = 60): Promise<SaleRow[]> {
  const { data, error } = await requireEngine()
    .from("sales")
    .select("id,sale_date,total_amount,payment_method,source_type,reconciled")
    .is("voided_at", null)
    .order("sale_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    date: r.sale_date,
    total: r.total_amount,
    payment: r.payment_method,
    source: r.source_type,
    reconciled: r.reconciled,
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
