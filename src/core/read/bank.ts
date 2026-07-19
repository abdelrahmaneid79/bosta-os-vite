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
    cashOut: Number(r.cash_out ?? 0), personalSpend: Number(r.personal_spend ?? 0),
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
  movements: number;
  /** Months whose chain is unbroken — their figures are exact. */
  exactMonths: number; totalMonths: number;
}

/** Roll the months up, and read the opening/closing balance off the ledger ends.
 *  Reversal refunds are excluded from cash out: a failed ATM attempt texts a
 *  debit and then reverses it, so counting it would double the withdrawal. */
export function buildOverview(txns: BankTxn[], months: BankMonth[], reversals: BankReversal[]): BankOverview {
  const dated = txns.filter((t) => t.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const inRange = months.filter((m) => m.movements > 0);
  const sum = (k: keyof BankMonth) => inRange.reduce((s, m) => s + (m[k] as number), 0);
  const reversedTotal = reversals.reduce((s, r) => s + r.amount, 0);
  const reversedCash = txns.filter((t) => t.isReversalRefund).reduce((s, t) => s + t.amount, 0);
  return {
    from: dated[0]?.date ?? null, to: dated[dated.length - 1]?.date ?? null,
    openingBalance: dated[0]?.balanceAfter ?? 0,
    closingBalance: dated[dated.length - 1]?.balanceAfter ?? 0,
    banked: sum("banked"), chequesNet: sum("chequesNet"),
    keptAsCash: sum("chequesNet") - sum("banked"),
    cashOut: sum("cashOut") - reversedCash,
    personalSpend: sum("personalSpend"),
    reversedTotal, movements: sum("movements"),
    exactMonths: inRange.filter((m) => m.unreadableBreaks === 0).length,
    totalMonths: inRange.length,
  };
}
