/** Expenses read-model — operating expenses ledger (independent of revenue /
 *  settlement). Personal withdrawals live in money_movements, NOT here. READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import type { Tables } from "@/core/db/tables";
import type { DateRange } from "./common";

export interface ExpenseRow {
  id: string; date: string; category: string; amount: number;
  isOperating: boolean; // false = cost-of-goods (inventory purchases), not a running expense
  paymentMethod: Tables<"expenses">["payment_method"]; notes: string | null;
}
export async function getExpenses(range: DateRange): Promise<ExpenseRow[]> {
  const sb = requireEngine();
  const [{ data, error }, cats] = await Promise.all([
    sb.from("expenses").select("id,expense_date,category_id,amount,payment_method,notes")
      .is("voided_at", null).gte("expense_date", range.from).lte("expense_date", range.to)
      .order("expense_date", { ascending: false }),
    sb.from("expense_categories").select("id,name,is_operating"),
  ]);
  if (error) throw error;
  const byId = new Map((cats.data ?? []).map((c) => [c.id, c]));
  return data.map((e) => ({
    id: e.id, date: e.expense_date, category: byId.get(e.category_id)?.name ?? "—",
    isOperating: byId.get(e.category_id)?.is_operating ?? true,
    amount: Number(e.amount), paymentMethod: e.payment_method, notes: e.notes,
  }));
}
/** Every recorded spend (operating + inventory/cost-of-goods). */
export async function getExpenseTotal(range: DateRange): Promise<number> {
  return (await getExpenses(range)).reduce((s, e) => s + e.amount, 0);
}
/** Running/operating expenses only (rent, salary, packaging…). Excludes inventory
 *  purchases, which are cost-of-goods and reach profit via per-sale COGS — counting
 *  them here too would double-charge the business. This is what the P&L uses. */
export async function getOperatingExpenseTotal(range: DateRange): Promise<number> {
  return (await getExpenses(range)).filter((e) => e.isOperating).reduce((s, e) => s + e.amount, 0);
}
/** Inventory / cost-of-goods spend (is_operating = false). */
export async function getInventorySpendTotal(range: DateRange): Promise<number> {
  return (await getExpenses(range)).filter((e) => !e.isOperating).reduce((s, e) => s + e.amount, 0);
}

export interface ExpenseCatStat {
  category: string;
  amount: number;       // this period
  prior: number;        // comparison period
  sharePct: number;     // % of this period's total spend
  changePct: number | null; // vs prior; null when prior is 0 (no fake %)
}
/** PURE: group expenses by category for the current period and compare to a
 *  prior period. Share is of the current total; change is withheld (null) when
 *  the prior period had nothing, so we never invent a percentage. */
export function aggregateExpenseCategories(
  current: { category: string; amount: number }[],
  prior: { category: string; amount: number }[],
): ExpenseCatStat[] {
  const sum = (rows: { category: string; amount: number }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.category, (m.get(r.category) ?? 0) + r.amount);
    return m;
  };
  const cur = sum(current);
  const pri = sum(prior);
  const total = [...cur.values()].reduce((s, v) => s + v, 0);
  const out: ExpenseCatStat[] = [];
  for (const [category, amount] of cur) {
    const prVal = pri.get(category) ?? 0;
    out.push({
      category, amount, prior: prVal,
      sharePct: total > 0 ? (amount / total) * 100 : 0,
      changePct: prVal > 0 ? ((amount - prVal) / prVal) * 100 : null,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export async function getExpenseCategoryTrends(current: DateRange, prior: DateRange): Promise<ExpenseCatStat[]> {
  const [cur, pri] = await Promise.all([getExpenses(current), getExpenses(prior)]);
  return aggregateExpenseCategories(
    cur.map((e) => ({ category: e.category, amount: e.amount })),
    pri.map((e) => ({ category: e.category, amount: e.amount })),
  );
}
export async function getExpenseCategories(): Promise<{ id: string; name: string; isOperating: boolean }[]> {
  const { data, error } = await requireEngine()
    .from("expense_categories").select("id,name,is_operating").eq("active", true).order("sort_order");
  if (error) throw error;
  return data.map((c) => ({ id: c.id, name: c.name, isOperating: c.is_operating }));
}

/** Owner settings (app_settings k/v). */
export async function getSettings(): Promise<Record<string, unknown>> {
  const { data, error } = await requireEngine().from("app_settings").select("key,value");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}
