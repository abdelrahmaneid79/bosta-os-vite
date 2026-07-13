/** Cash reconciliation + difference intelligence — PURE (Cycle 8).
 *
 *  The FIRST verified count is a baseline: any gap vs the historical ledger is
 *  an OPENING DIFFERENCE, never an expense/loss/withdrawal. From the second
 *  count on, strict interval reconciliation runs and unexplained differences
 *  get evidence-led (never accusatory) candidate explanations. */

const r0 = (n: number) => Math.round(n);

/* ── opening baseline ─────────────────────────────────────────────────── */

export interface OpeningBaseline {
  countedAmount: number;
  ledgerExpected: number | null;
  openingDifference: number | null;   // ledger − counted; informational only
  classification: "opening_baseline_difference";
  note: string;
}

/** Compute the opening-difference classification for the first count.
 *  It is EXPLICITLY not an expense/withdrawal/loss — just the gap between a
 *  historical ledger guess and the first real physical count. */
export function classifyOpeningBaseline(countedAmount: number, ledgerExpected: number | null): OpeningBaseline {
  const diff = ledgerExpected != null ? r0(ledgerExpected - countedAmount) : null;
  return {
    countedAmount: r0(countedAmount),
    ledgerExpected: ledgerExpected != null ? r0(ledgerExpected) : null,
    openingDifference: diff,
    classification: "opening_baseline_difference",
    note: diff == null
      ? "First verified count — the opening cash baseline. No prior ledger to compare against."
      : `First verified count — the opening baseline. The ${Math.abs(diff).toLocaleString()} EGP gap vs the historical ledger is an opening difference, NOT an expense, loss or withdrawal. Reconciliation starts fresh from here.`,
  };
}

/* ── interval reconciliation (count pairs) ────────────────────────────── */

export interface ReconciliationInputs {
  openingDate: string;
  openingCash: number;              // prior verified count
  closingDate: string;
  closingCash: number;              // this verified count
  /** movements strictly inside (openingDate, closingDate], all in EGP */
  chequeProceedsToCash: number;     // cheques actually recorded as cash/account IN
  ownerInjections: number;
  otherAdditions: number;
  cashExpenses: number;
  cashPurchases: number;
  ownerWithdrawals: number;
  corrections: number;              // signed
  otherReductions: number;
  /** true when a movement in the interval lacks a payment method */
  hasUnknownPaymentMethod: boolean;
}

export interface Reconciliation {
  openingCash: number;
  additions: number;
  reductions: number;
  expectedClosing: number;
  actualClosing: number;
  difference: number;               // actual − expected
  unexplained: number;              // same, after explained adjustments (0 here — adjustments are owner-driven)
  completeness: number;             // 0–100
  confidence: "high" | "medium" | "low";
  intervalDays: number;
  note: string;
}

export function reconcileInterval(i: ReconciliationInputs): Reconciliation {
  const additions = i.chequeProceedsToCash + i.ownerInjections + i.otherAdditions + Math.max(0, i.corrections);
  const reductions = i.cashExpenses + i.cashPurchases + i.ownerWithdrawals + i.otherReductions + Math.max(0, -i.corrections);
  const expected = i.openingCash + additions - reductions;
  const diff = i.closingCash - expected;
  const days = Math.max(1, Math.round((Date.parse(i.closingDate) - Date.parse(i.openingDate)) / 86_400_000));
  // completeness drops when payment methods are unknown (cash sales can't be derived — cheque-settled model)
  const completeness = i.hasUnknownPaymentMethod ? 70 : 90;
  return {
    openingCash: r0(i.openingCash),
    additions: r0(additions),
    reductions: r0(reductions),
    expectedClosing: r0(expected),
    actualClosing: r0(i.closingCash),
    difference: r0(diff),
    unexplained: r0(diff),
    completeness,
    confidence: i.hasUnknownPaymentMethod ? "low" : Math.abs(diff) < 50 ? "high" : "medium",
    intervalDays: days,
    note: "Cheque revenue is NOT counted as drawer cash — only recorded cash/account movements are. Sales settle via mall cheque; drawer cash cannot be derived from sales.",
  };
}

/* ── difference investigation ─────────────────────────────────────────── */

export type DifferenceClass =
  | "missing_cash_expense" | "missing_withdrawal" | "missing_injection"
  | "missing_purchase_payment" | "payment_method_mismatch" | "duplicate_movement"
  | "reversed_transaction_mismatch" | "count_entry_error" | "settlement_timing_mismatch"
  | "opening_baseline_limitation" | "unresolved";

export interface CandidateExplanation {
  cls: DifferenceClass;
  label: string;
  likelihood: "likely" | "possible" | "unlikely";
  suggestedAction: string;
  screenLink: string;
}

/** Evidence-led candidate explanations for a non-zero difference. NEUTRAL
 *  language only — a shortage is a "difference", never theft/loss. */
export function classifyDifference(recon: Reconciliation, ctx: { isFirstAfterBaseline: boolean; hasUnknownPaymentMethod: boolean }): CandidateExplanation[] {
  const out: CandidateExplanation[] = [];
  const shortage = recon.difference < 0;      // less cash than expected
  const amt = Math.abs(recon.difference);
  if (amt < 10) return out;                    // within noise

  if (ctx.isFirstAfterBaseline) {
    out.push({ cls: "opening_baseline_limitation", label: "Opening baseline still settling", likelihood: "possible", suggestedAction: "Early intervals after the first count can carry baseline noise — watch the trend before acting.", screenLink: "/money" });
  }
  if (ctx.hasUnknownPaymentMethod) {
    out.push({ cls: "payment_method_mismatch", label: "A movement's payment method is unknown", likelihood: "likely", suggestedAction: "Set the payment method on interval movements so cash vs cheque is unambiguous.", screenLink: "/money" });
  }
  if (shortage) {
    out.push({ cls: "missing_cash_expense", label: "A cash expense may be unrecorded", likelihood: "likely", suggestedAction: "Check for a paid-in-cash expense not yet entered for this interval.", screenLink: "/expenses" });
    out.push({ cls: "missing_withdrawal", label: "An owner withdrawal may be unrecorded", likelihood: "possible", suggestedAction: "Confirm whether cash was taken out and not logged.", screenLink: "/money" });
    out.push({ cls: "missing_purchase_payment", label: "A cash-paid purchase may be unrecorded", likelihood: "possible", suggestedAction: "Check for stock bought with cash this interval.", screenLink: "/purchases" });
  } else {
    out.push({ cls: "missing_injection", label: "An owner injection may be unrecorded", likelihood: "likely", suggestedAction: "Confirm whether cash was added and not logged.", screenLink: "/money" });
    out.push({ cls: "duplicate_movement", label: "A movement may be double-counted", likelihood: "possible", suggestedAction: "Check for a duplicated cash entry in the interval.", screenLink: "/money" });
  }
  out.push({ cls: "count_entry_error", label: "A count may have been mis-keyed", likelihood: "possible", suggestedAction: "Re-verify the opening and closing count figures.", screenLink: "/money" });
  out.push({ cls: "unresolved", label: "Leave unresolved for now", likelihood: "possible", suggestedAction: "Record the difference as unresolved; investigate when convenient. Nothing is auto-adjusted.", screenLink: "/money" });
  return out;
}
