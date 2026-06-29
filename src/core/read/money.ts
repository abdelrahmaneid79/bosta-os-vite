/** Money read-model. A UNIFIED cash view: the signed money_movements ledger
 *  (cheques in, owner injections, withdrawals, manual cash in/out) merged with
 *  the money that actually leaves the drawer — expenses and stock purchases — so
 *  "cash on hand" reflects real inflows AND outflows, not just cheques received.
 *  READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { todayCairo } from "@/core/time";
import type { Tables } from "@/core/db/tables";
import type { DateRange } from "./common";
import { getExpenses, getExpenseTotal } from "./expenses";
import { getPurchases, getPurchaseTotal } from "./purchases";

const EPOCH = "2000-01-01";
const r2 = (n: number) => Math.round(n * 100) / 100;

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

/** True cash position (all-time): money in (cheques, injections, cash-in) minus
 *  money out (withdrawals, manual cash-out, expenses, stock purchases). This is
 *  the honest "cash on hand" — the stored money_accounts balance only tracks the
 *  movements ledger and ignores expenses, so it overstates reality. */
export interface CashPosition { onHand: number; inflowsAll: number; outflowsAll: number }
export async function getCashPosition(): Promise<CashPosition> {
  const sb = requireEngine();
  const today = todayCairo();
  const [mvRes, expAll, purAll] = await Promise.all([
    sb.from("money_movements").select("amount").is("voided_at", null),
    getExpenseTotal({ from: EPOCH, to: today }),
    getPurchaseTotal({ from: EPOCH, to: today }),
  ]);
  if (mvRes.error) throw mvRes.error;
  let mvIn = 0, mvOut = 0;
  for (const m of mvRes.data) { if (m.amount >= 0) mvIn += m.amount; else mvOut += Math.abs(m.amount); }
  const inflowsAll = r2(mvIn);
  const outflowsAll = r2(mvOut + expAll + purAll);
  return { onHand: r2(inflowsAll - outflowsAll), inflowsAll, outflowsAll };
}

/** One row in the unified cash flow: signed amount (+ in / − out) with its source. */
export type CashKind = "cheque" | "withdrawal" | "expense" | "purchase" | "cash_in" | "cash_out";
export interface CashEntry { id: string; date: string; label: string; amount: number; kind: CashKind }
/** Every cash flow in range — movements + expenses + purchases — newest first. */
export async function getCashLedger(range: DateRange): Promise<CashEntry[]> {
  const [mv, exps, purs] = await Promise.all([getMoneyMovements(range, 1000), getExpenses(range), getPurchases(range)]);
  const entries: CashEntry[] = [];
  for (const m of mv) {
    const label = m.notes ? `${m.type.replace(/_/g, " ")} · ${m.notes}` : m.type.replace(/_/g, " ");
    const kind: CashKind = m.isWithdrawal ? "withdrawal" : m.type === "cheque_inflow" ? "cheque" : m.amount >= 0 ? "cash_in" : "cash_out";
    entries.push({ id: `mv-${m.id}`, date: m.date, label, amount: m.amount, kind });
  }
  for (const e of exps) entries.push({ id: `ex-${e.id}`, date: e.date, label: e.category + (e.notes ? ` · ${e.notes}` : ""), amount: -e.amount, kind: "expense" });
  for (const p of purs) entries.push({ id: `pu-${p.id}`, date: p.date, label: `Stock · ${p.productName}`, amount: -p.totalCost, kind: "purchase" });
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export interface CashSummary {
  balance: number | null; inflow: number; outflow: number; withdrawals: number;
}
/** Range summary over the unified ledger: balance is the all-time net position;
 *  inflow/outflow span cheques, cash moves, expenses and purchases in range. */
export async function getCashSummary(range: DateRange): Promise<CashSummary> {
  const [pos, ledger] = await Promise.all([getCashPosition(), getCashLedger(range)]);
  let inflow = 0, outflow = 0, withdrawals = 0;
  for (const e of ledger) {
    if (e.amount >= 0) inflow += e.amount; else outflow += e.amount;
    if (e.kind === "withdrawal") withdrawals += Math.abs(e.amount);
  }
  return { balance: pos.onHand, inflow: r2(inflow), outflow: r2(outflow), withdrawals: r2(withdrawals) };
}
