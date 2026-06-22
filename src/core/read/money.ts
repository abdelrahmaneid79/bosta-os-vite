/** Money read-model. Signed money_movements ledger; personal_withdrawal is a
 *  cash movement, NOT an operating expense (kept separate). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import type { Tables } from "@/core/db/tables";
import type { DateRange } from "./common";

export interface MoneyAccount {
  id: string; name: string; balance: number; opening: number;
}
export async function getMoneyAccounts(): Promise<MoneyAccount[]> {
  const { data, error } = await requireEngine()
    .from("money_accounts").select("id,name,current_balance,opening_balance,active").eq("active", true).order("name");
  if (error) throw error;
  return data.map((a) => ({ id: a.id, name: a.name, balance: a.current_balance, opening: a.opening_balance }));
}

export interface MoneyMovement {
  id: string; date: string; type: Tables<"money_movements">["movement_type"];
  amount: number; notes: string | null; isWithdrawal: boolean;
}
export async function getMoneyMovements(range: DateRange, limit = 80): Promise<MoneyMovement[]> {
  const { data, error } = await requireEngine()
    .from("money_movements").select("id,movement_date,movement_type,amount,notes")
    .gte("movement_date", range.from).lte("movement_date", range.to)
    .order("movement_date", { ascending: false }).limit(limit);
  if (error) throw error;
  return data.map((m) => ({
    id: m.id, date: m.movement_date, type: m.movement_type, amount: m.amount, notes: m.notes,
    isWithdrawal: m.movement_type === "personal_withdrawal",
  }));
}

export interface CashSummary {
  balance: number | null; inflow: number; outflow: number; withdrawals: number;
}
export async function getCashSummary(range: DateRange): Promise<CashSummary> {
  const sb = requireEngine();
  const [accts, mv] = await Promise.all([getMoneyAccounts(), sb
    .from("money_movements").select("movement_type,amount")
    .gte("movement_date", range.from).lte("movement_date", range.to)]);
  if (mv.error) throw mv.error;
  let inflow = 0, outflow = 0, withdrawals = 0;
  for (const m of mv.data) {
    if (m.amount >= 0) inflow += m.amount; else outflow += m.amount;
    if (m.movement_type === "personal_withdrawal") withdrawals += Math.abs(m.amount);
  }
  return { balance: accts[0]?.balance ?? null, inflow, outflow, withdrawals };
}
