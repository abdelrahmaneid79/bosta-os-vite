/**
 * SETTLEMENT RECONCILIATION (pure)
 * --------------------------------
 * For a settlement period: revenue − deductions (rent, revenue-share, other) =
 * expected net, compared against the cheque(s) actually received. Produces
 * outstanding balance, over/under status, and days outstanding. Also a pure
 * matcher that suggests which recorded cheque best fits an expected amount.
 * All deterministic + unit-tested; the read-model supplies the rows.
 */
export interface DeductionLite { type: string; amount: number; rate: number | null }
export interface ChequeLite { id: string; received: number | null; expected: number; date: string | null; status: string }

export type SettlementStatus = "settled" | "partial" | "awaiting" | "over";

export interface SettlementView {
  revenue: number;
  deductions: DeductionLite[];
  totalDeductions: number;
  expected: number;        // net expected = revenue − deductions (never below 0 for display)
  received: number;        // Σ cheque amounts received
  outstanding: number;     // expected − received (can be negative if overpaid)
  status: SettlementStatus;
  daysOutstanding: number | null; // since period end, when money is still due
  overdue: boolean;        // outstanding and > OVERDUE_DAYS past period end
}

export const OVERDUE_DAYS = 45; // a settlement still unpaid this long after the month closes is overdue
const r2 = (n: number) => Math.round(n * 100) / 100;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function composeSettlement(input: {
  revenue: number; deductions: DeductionLite[]; netExpected: number;
  cheques: ChequeLite[]; periodEnd: string | null; today: string;
}): SettlementView {
  const totalDeductions = r2(input.deductions.reduce((s, d) => s + d.amount, 0));
  const expected = r2(input.netExpected);
  const received = r2(input.cheques.reduce((s, c) => s + (c.received ?? 0), 0));
  const outstanding = r2(expected - received);
  const tol = Math.max(1, Math.abs(expected) * 0.005); // 0.5% tolerance
  let status: SettlementStatus;
  if (received <= 0) status = "awaiting";
  else if (received > expected + tol) status = "over";
  else if (Math.abs(outstanding) <= tol) status = "settled";
  else status = "partial";
  const stillDue = status === "awaiting" || status === "partial";
  const daysOutstanding = stillDue && input.periodEnd ? Math.max(0, daysBetween(input.periodEnd, input.today)) : null;
  const overdue = daysOutstanding != null && daysOutstanding > OVERDUE_DAYS;
  return { revenue: r2(input.revenue), deductions: input.deductions, totalDeductions, expected, received, outstanding, status, daysOutstanding, overdue };
}

/** Suggest the recorded cheque that best matches an expected amount — closest
 *  within a tolerance band. Returns null when nothing is close enough. */
export function suggestCheque(expected: number, candidates: ChequeLite[], bandPct = 0.1): ChequeLite | null {
  const band = Math.max(50, Math.abs(expected) * bandPct);
  let best: ChequeLite | null = null;
  let bestDelta = Infinity;
  for (const c of candidates) {
    const amt = c.received ?? c.expected;
    const delta = Math.abs(amt - expected);
    if (delta <= band && delta < bestDelta) { best = c; bestDelta = delta; }
  }
  return best;
}
