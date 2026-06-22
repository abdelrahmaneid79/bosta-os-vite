/** Expenses read-model — operating expenses ledger (independent of revenue /
 *  settlement). Personal withdrawals live in money_movements, NOT here. READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import type { Tables } from "@/core/db/tables";
import type { DateRange } from "./common";

export interface ExpenseRow {
  id: string; date: string; category: string; amount: number;
  paymentMethod: Tables<"expenses">["payment_method"]; notes: string | null;
}
export async function getExpenses(range: DateRange): Promise<ExpenseRow[]> {
  const sb = requireEngine();
  const [{ data, error }, cats] = await Promise.all([
    sb.from("expenses").select("id,expense_date,category_id,amount,payment_method,notes")
      .is("voided_at", null).gte("expense_date", range.from).lte("expense_date", range.to)
      .order("expense_date", { ascending: false }),
    sb.from("expense_categories").select("id,name"),
  ]);
  if (error) throw error;
  const names = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  return data.map((e) => ({
    id: e.id, date: e.expense_date, category: names.get(e.category_id) ?? "—",
    amount: Number(e.amount), paymentMethod: e.payment_method, notes: e.notes,
  }));
}
export async function getExpenseTotal(range: DateRange): Promise<number> {
  return (await getExpenses(range)).reduce((s, e) => s + e.amount, 0);
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
