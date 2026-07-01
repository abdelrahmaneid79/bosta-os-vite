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

/** Clean-books anchor: from `date`, the live cash position is `openingCash` plus
 *  only the flows on/after that date — the earlier (partial/mixed) era is carried
 *  forward as a single opening balance, not reconstructed. Stored in app_settings
 *  `books_start` = { date, openingCash }. Until openingCash is set, cash falls back
 *  to the all-time net so nothing breaks. */
export interface BooksStart { date: string | null; openingCash: number | null }
export async function getBooksStart(): Promise<BooksStart> {
  const { data } = await requireEngine().from("app_settings").select("value").eq("key", "books_start").maybeSingle();
  const v = (data?.value ?? null) as { date?: string; openingCash?: number | null } | null;
  return {
    date: typeof v?.date === "string" ? v.date : null,
    openingCash: typeof v?.openingCash === "number" ? v.openingCash : null,
  };
}

/** Honest "cash on hand". With a clean-books opening balance set, this is
 *  openingCash + (inflows − outflows) since the books-start date; otherwise it's
 *  the all-time net (cheques in − expenses, purchases, withdrawals, cash-out). */
export interface CashPosition { onHand: number; inflowsAll: number; outflowsAll: number; opening: number; since: string | null }
export async function getCashPosition(): Promise<CashPosition> {
  const sb = requireEngine();
  const today = todayCairo();
  const books = await getBooksStart();
  const anchored = !!(books.date && books.openingCash != null);
  const from = anchored ? books.date! : EPOCH;
  const opening = anchored ? books.openingCash! : 0;
  const [mvRes, chqRes, expFwd, purFwd] = await Promise.all([
    sb.from("money_movements").select("amount").is("voided_at", null).neq("movement_type", "cheque_inflow").gte("movement_date", from),
    sb.from("cheques").select("amount_received").is("voided_at", null).not("received_date", "is", null).gte("received_date", from),
    getExpenseTotal({ from, to: today }),
    getPurchaseTotal({ from, to: today }),
  ]);
  if (mvRes.error) throw mvRes.error;
  if (chqRes.error) throw chqRes.error;
  let mvIn = 0, mvOut = 0;
  for (const m of mvRes.data) { if (m.amount >= 0) mvIn += m.amount; else mvOut += Math.abs(m.amount); }
  const chqIn = (chqRes.data ?? []).reduce((s, c) => s + Number(c.amount_received ?? 0), 0);
  const inflowsAll = r2(opening + mvIn + chqIn);
  const outflowsAll = r2(mvOut + expFwd + purFwd);
  return { onHand: r2(inflowsAll - outflowsAll), inflowsAll, outflowsAll, opening, since: anchored ? books.date : null };
}

/** One row in the unified cash flow: signed amount (+ in / − out) with its source. */
export type CashKind = "cheque" | "withdrawal" | "expense" | "purchase" | "cash_in" | "cash_out";
export interface CashEntry { id: string; date: string; label: string; amount: number; kind: CashKind }
/** Every cash flow in range — movements + expenses + purchases — newest first.
 *  When a clean-books opening balance is set, flows before the books-start date
 *  are excluded (that era is carried forward as the opening balance instead). */
export async function getCashLedger(range: DateRange): Promise<CashEntry[]> {
  const sb = requireEngine();
  const [mv, exps, purs, chqRes] = await Promise.all([
    getMoneyMovements(range, 1000), getExpenses(range), getPurchases(range),
    sb.from("cheques").select("id,received_date,amount_received").is("voided_at", null)
      .not("received_date", "is", null).gte("received_date", range.from).lte("received_date", range.to),
  ]);
  if (chqRes.error) throw chqRes.error;
  const entries: CashEntry[] = [];
  // Cheques settled by the mall are real cash coming IN.
  for (const c of chqRes.data ?? []) {
    if (c.amount_received != null && c.received_date) entries.push({ id: `ch-${c.id}`, date: c.received_date, label: "Cheque · mall settlement", amount: Number(c.amount_received), kind: "cheque" });
  }
  for (const m of mv) {
    // Cheques are counted once, from the authoritative `cheques` table above.
    // Skip cheque_inflow movements (imported history duplicates) to avoid double-counting.
    if (m.type === "cheque_inflow") continue;
    const label = m.notes ? `${m.type.replace(/_/g, " ")} · ${m.notes}` : m.type.replace(/_/g, " ");
    const kind: CashKind = m.isWithdrawal ? "withdrawal" : m.amount >= 0 ? "cash_in" : "cash_out";
    entries.push({ id: `mv-${m.id}`, date: m.date, label, amount: m.amount, kind });
  }
  for (const e of exps) entries.push({ id: `ex-${e.id}`, date: e.date, label: e.category + (e.notes ? ` · ${e.notes}` : ""), amount: -e.amount, kind: "expense" });
  for (const p of purs) entries.push({ id: `pu-${p.id}`, date: p.date, label: `Stock · ${p.productName}`, amount: -p.totalCost, kind: "purchase" });
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export interface CashSummary {
  balance: number | null; inflow: number; outflow: number; withdrawals: number;
  opening: number; since: string | null;
}
/** Range summary over the unified ledger: balance is the live net position
 *  (opening balance + flows since books-start, or all-time if no books-start);
 *  inflow/outflow span cheques, cash moves, expenses and purchases in range. */
export async function getCashSummary(range: DateRange): Promise<CashSummary> {
  const [pos, ledger] = await Promise.all([getCashPosition(), getCashLedger(range)]);
  let inflow = 0, outflow = 0, withdrawals = 0;
  for (const e of ledger) {
    if (e.amount >= 0) inflow += e.amount; else outflow += e.amount;
    if (e.kind === "withdrawal") withdrawals += Math.abs(e.amount);
  }
  return { balance: pos.onHand, inflow: r2(inflow), outflow: r2(outflow), withdrawals: r2(withdrawals), opening: pos.opening, since: pos.since };
}
