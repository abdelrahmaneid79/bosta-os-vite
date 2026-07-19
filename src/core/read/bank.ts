/** Bank card ****8300 read-model.
 *
 *  Where this data comes from: 13 months of Banque Misr SMS, transcribed from a
 *  screen recording the owner made. Every message states the balance left after
 *  it, so the rows chain together and a missing message shows up as a break —
 *  that is what `chainGap` records and what makes the deposits findable.
 *
 *  The one number that matters here is `keptAsCash`: the mall's cheque money
 *  that never entered this account. The owner banks part of a cheque and keeps
 *  the rest, and until now nothing in BostaOS could see that.
 *
 *  READ-ONLY. Category edits go through mutations.
 */
import { requireEngine } from "@/core/db/engine";

export type BankSide = "business" | "personal" | "check" | "ignore";

export interface BankTxn {
  id: string;
  date: string | null;
  merchant: string | null;
  place: string | null;
  bank: string | null;
  direction: "debit" | "credit";
  amount: number;
  balanceAfter: number;
  category: string;
  side: BankSide;
  edited: boolean;
  note: string | null;
  /** Difference between this balance and what the previous row predicted.
   *  Positive = money arrived with no SMS. Negative = money left with no SMS. */
  chainGap: number | null;
  /** How much arrived just before this row, when the gap was money coming in. */
  depositAmount: number | null;
  isReversalRefund: boolean;
  /** True on the single row whose balance was computed from its neighbours
   *  because the message itself was clipped off screen. */
  balanceDerived: boolean;
  raw: string | null;
}

export interface BankMonth {
  month: string;
  chequesNet: number;
  chequeCount: number;
  banked: number;
  keptAsCash: number;
  cashOut: number;
  personalSpend: number;
  movements: number;
  /** Failed ATM attempts whose refund the chain actually shows coming back.
   *  Already netted out of cashOut — never subtract it a second time. */
  refundsReturned: number;
  /** Breaks in the chain — stretches the recording could not show. Where this
   *  is 0, the month's figures are exact; nothing can hide in an intact chain. */
  unreadableBreaks: number;
}

export interface BankReversal {
  id: string;
  dayMonth: string | null;
  merchant: string | null;
  amount: number;
  refundConfirmed: boolean;
  note: string | null;
}

/** The categories the import assigns, and how each one is meant to be read. */
export const BANK_CATEGORIES: { key: string; label: string; side: BankSide; hint: string }[] = [
  { key: "deposit",        label: "Money in",        side: "business", hint: "A mall cheque clearing." },
  { key: "cash_stock",     label: "Cash — stock run", side: "business", hint: "2,000+ drawn at a machine. Most likely buying stock." },
  { key: "cash_small",     label: "Cash — small",     side: "check",    hint: "Under 2,000. Could be either." },
  { key: "hyper_hub",      label: "Hyper Hub",        side: "personal", hint: "The host store." },
  { key: "eating_out",     label: "Eating out",       side: "personal", hint: "" },
  { key: "groceries",      label: "Groceries",        side: "personal", hint: "" },
  { key: "fuel_car",       label: "Fuel / car",       side: "personal", hint: "" },
  { key: "bills",          label: "Bills / phone",    side: "personal", hint: "Fawry, Etisalat, traffic fines." },
  { key: "personal_other", label: "Personal — other", side: "personal", hint: "A shop we can name but not classify." },
  { key: "unknown",        label: "Could not read",   side: "check",    hint: "The message itself was unreadable." },
];
export const catLabel = (k: string) => BANK_CATEGORIES.find((c) => c.key === k)?.label ?? k;

export async function getBankTxns(): Promise<BankTxn[]> {
  const { data, error } = await requireEngine()
    .from("bank_transactions")
    .select("id,txn_date,merchant,place,bank,direction,amount,balance_after,category,side,category_edited,note,chain_gap,deposit_amount,is_reversal_refund,balance_derived,raw")
    .is("voided_at", null)
    .order("txn_date", { ascending: false, nullsFirst: false })
    .order("balance_after", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, date: r.txn_date, merchant: r.merchant, place: r.place, bank: r.bank,
    direction: r.direction as "debit" | "credit",
    amount: Number(r.amount ?? 0), balanceAfter: Number(r.balance_after ?? 0),
    category: r.category, side: r.side as BankSide, edited: !!r.category_edited, note: r.note,
    chainGap: r.chain_gap == null ? null : Number(r.chain_gap),
    depositAmount: r.deposit_amount == null ? null : Number(r.deposit_amount),
    isReversalRefund: !!r.is_reversal_refund, balanceDerived: !!r.balance_derived, raw: r.raw,
  }));
}

export async function getBankMonths(): Promise<BankMonth[]> {
  const { data, error } = await requireEngine()
    .from("v_bank_month").select("*").order("month");
  if (error) throw error;
  return (data ?? []).filter((r) => r.month).map((r) => ({
    month: r.month as string, chequesNet: Number(r.cheques_net ?? 0), chequeCount: Number(r.cheque_count ?? 0),
    banked: Number(r.banked ?? 0), keptAsCash: Number(r.kept_as_cash ?? 0),
    cashOut: Number(r.cash_out ?? 0), refundsReturned: Number(r.refunds_returned ?? 0),
    personalSpend: Number(r.personal_spend ?? 0),
    movements: Number(r.movements ?? 0), unreadableBreaks: Number(r.unreadable_breaks ?? 0),
  }));
}

export async function getBankReversals(): Promise<BankReversal[]> {
  const { data, error } = await requireEngine()
    .from("bank_reversals").select("id,day_month,merchant,amount,refund_confirmed,note").order("day_month");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, dayMonth: r.day_month, merchant: r.merchant,
    amount: Number(r.amount), refundConfirmed: !!r.refund_confirmed, note: r.note,
  }));
}

export interface BankOverview {
  from: string | null; to: string | null;
  openingBalance: number; closingBalance: number;
  banked: number;            // cheque money seen arriving
  chequesNet: number;        // what the cheque book says should have arrived
  keptAsCash: number;        // the rest — never entered this account
  cashOut: number;           // withdrawn at machines (excludes failed attempts)
  personalSpend: number;
  reversedTotal: number;     // failed attempts, refunded, never spending
  refundsReturned: number;   // of which the chain can actually show returning
  movements: number;
  /** Months whose chain is unbroken — their figures are exact. */
  exactMonths: number; totalMonths: number;
}

/** Roll the months up, and read the opening/closing balance off the ledger ends.
 *
 *  cashOut arrives ALREADY net of refunds: the view subtracts the refund the
 *  balance chain actually shows coming back after a failed ATM attempt. An
 *  earlier version subtracted them a second time here, which understated the
 *  cash withdrawn — do not reintroduce that. */
export function buildOverview(txns: BankTxn[], months: BankMonth[], reversals: BankReversal[]): BankOverview {
  const dated = txns.filter((t) => t.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const inRange = months.filter((m) => m.movements > 0);
  const sum = (k: keyof BankMonth) => inRange.reduce((s, m) => s + (m[k] as number), 0);
  const reversedTotal = reversals.reduce((s, r) => s + r.amount, 0);
  return {
    from: dated[0]?.date ?? null, to: dated[dated.length - 1]?.date ?? null,
    openingBalance: dated[0]?.balanceAfter ?? 0,
    closingBalance: dated[dated.length - 1]?.balanceAfter ?? 0,
    banked: sum("banked"), chequesNet: sum("chequesNet"),
    keptAsCash: sum("chequesNet") - sum("banked"),
    cashOut: sum("cashOut"),
    personalSpend: sum("personalSpend"),
    reversedTotal, refundsReturned: sum("refundsReturned"), movements: sum("movements"),
    exactMonths: inRange.filter((m) => m.unreadableBreaks === 0).length,
    totalMonths: inRange.length,
  };
}

// ── What the business earned vs what the owner actually took out ────────────

export interface BurnMonth {
  month: string;
  revenue: number; cogs: number; mallDeductions: number; runningCosts: number;
  /** Revenue less the mall's cut, the cost of what was sold, and running costs. */
  profit: number;
  cashKeptFromCheques: number; cashFromAtm: number; cashAvailable: number;
  cashTheBusinessNeeded: number;
  /** Cash left after stock and running costs — what he took for himself.
   *  A residual: it absorbs every upstream error, so read it over a year, not
   *  a month. Single months swing negative purely on timing (stock bought in
   *  one month is sold across the next two). */
  drawingsResidual: number;
  personalCardSpend: number;
  /** Sales recorded but no cost of sales — the day's product breakdown is
   *  missing, so this month's profit is meaningless and must be left out. */
  cogsMissing: boolean;
  unreadableBreaks: number;
}

export interface BurnSummary {
  months: number;
  revenue: number; cogs: number; mallDeductions: number; runningCosts: number;
  profit: number; profitPerMonth: number;
  cashAvailable: number; cashTheBusinessNeeded: number;
  drawings: number; personalCardSpend: number;
  tookOut: number; tookOutPerMonth: number;
  /** What he took as a share of what the business made. Over 100 means he is
   *  drawing more than the business earns. */
  pctOfProfit: number | null;
  excludedMonths: number;
}

export async function getBurnMonths(): Promise<BurnMonth[]> {
  const { data, error } = await requireEngine().from("v_owner_burn").select("*").order("month");
  if (error) throw error;
  return (data ?? []).filter((r) => r.month).map((r) => ({
    month: r.month as string,
    revenue: Number(r.revenue ?? 0), cogs: Number(r.cogs ?? 0),
    mallDeductions: Number(r.mall_deductions ?? 0), runningCosts: Number(r.running_costs ?? 0),
    profit: Number(r.profit ?? 0),
    cashKeptFromCheques: Number(r.cash_kept_from_cheques ?? 0),
    cashFromAtm: Number(r.cash_from_atm ?? 0),
    cashAvailable: Number(r.cash_available ?? 0),
    cashTheBusinessNeeded: Number(r.cash_the_business_needed ?? 0),
    drawingsResidual: Number(r.drawings_residual ?? 0),
    personalCardSpend: Number(r.personal_card_spend ?? 0),
    cogsMissing: !!r.cogs_missing, unreadableBreaks: Number(r.unreadable_breaks ?? 0),
  }));
}

/** Months with sales but no cost of sales are dropped: their profit would be
 *  the full revenue, which would flatter every average built on top of it. */
export function summariseBurn(rows: BurnMonth[]): BurnSummary {
  const usable = rows.filter((r) => !r.cogsMissing && (r.revenue > 0 || r.cashAvailable > 0));
  const n = usable.length || 1;
  const sum = (k: keyof BurnMonth) => usable.reduce((s, r) => s + (r[k] as number), 0);
  const profit = sum("profit");
  const tookOut = sum("drawingsResidual") + sum("personalCardSpend");
  return {
    months: usable.length,
    revenue: sum("revenue"), cogs: sum("cogs"),
    mallDeductions: sum("mallDeductions"), runningCosts: sum("runningCosts"),
    profit, profitPerMonth: profit / n,
    cashAvailable: sum("cashAvailable"), cashTheBusinessNeeded: sum("cashTheBusinessNeeded"),
    drawings: sum("drawingsResidual"), personalCardSpend: sum("personalCardSpend"),
    tookOut, tookOutPerMonth: tookOut / n,
    pctOfProfit: profit > 0 ? (100 * tookOut) / profit : null,
    excludedMonths: rows.length - usable.length,
  };
}
