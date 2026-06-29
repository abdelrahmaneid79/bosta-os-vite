/** Purchases read-model. Each non-voided batch is a stock-IN that feeds WAC.
 *  READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { getProducts, productMap } from "./common";
import type { DateRange } from "./common";

export interface PurchaseRow {
  id: string;
  date: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export async function getPurchases(range: DateRange): Promise<PurchaseRow[]> {
  const sb = requireEngine();
  const [{ data, error }, products] = await Promise.all([
    sb.from("purchase_batches")
      .select("id,purchase_date,product_id,quantity,unit_cost,total_cost")
      .is("voided_at", null)
      .gte("purchase_date", range.from)
      .lte("purchase_date", range.to)
      .order("purchase_date", { ascending: false }),
    getProducts(),
  ]);
  if (error) throw error;
  const pm = productMap(products);
  return data.map((r) => ({
    id: r.id,
    date: r.purchase_date,
    productId: r.product_id,
    productName: pm.get(r.product_id)?.name_en ?? "Unknown",
    quantity: r.quantity,
    unitCost: r.unit_cost,
    totalCost: r.total_cost,
  }));
}

export async function getPurchaseTotal(range: DateRange): Promise<number> {
  const rows = await getPurchases(range);
  return rows.reduce((s, r) => s + r.totalCost, 0);
}

/** Historical/lump inventory buying lives in the expenses ledger (cost-of-goods
 *  category, is_operating = false) because it has no per-product detail. Surface
 *  it here so stock spend shows in the Inventory area, not buried in Expenses. */
export interface InventoryPurchase { id: string; date: string; note: string; totalCost: number }
export async function getInventoryPurchases(range: DateRange): Promise<InventoryPurchase[]> {
  const { getExpenses } = await import("./expenses");
  const exps = await getExpenses(range);
  return exps
    .filter((e) => !e.isOperating)
    .map((e) => ({ id: e.id, date: e.date, note: e.notes || e.category, totalCost: e.amount }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
