/** Cash Intelligence — PURE Layer 2 (Cycle 7).
 *
 *  Composes the deterministic CashState: money available NOW (verified),
 *  money EXPECTED (settlement pipe), money COMMITTED (obligations), money
 *  UNCERTAIN (untracked dimensions), owner movements, and the safety result.
 *  These blocks are never collapsed into one "balance".
 *
 *  Bosta-specific truths encoded here:
 *  - ALL revenue realizes as mall settlement cheques (sales payment methods
 *    are untracked) — daily sales do NOT add drawer cash.
 *  - Rent + the revenue share are DEDUCTED FROM THE CHEQUE by the mall —
 *    they are never cash outflows and must not appear as cash obligations.
 *  - Cheque clearing is not tracked in the schema — received amounts are
 *    treated as banked, and that assumption is surfaced, not hidden. */
import type { StrategistSnapshot } from "../contract";
import type { Evidence, Finding, FindingConfidence, Urgency } from "./types";
import { ev } from "./engine";

const r0 = (n: number) => Math.round(n);
const egp = (n: number) => `EGP ${Math.round(n).toLocaleString("en-US")}`;

/* ═══ OBLIGATION CALENDAR ═════════════════════════════════════════════ */

export interface Obligation {
  name: string;
  amount: number;
  /** exact date when known; otherwise a window or "date not recorded" */
  due: { date?: string; window?: "next_7" | "next_14" | "next_30"; label: string };
  basis: "recorded" | "recurring_derived" | "accepted_action";
  confidence: FindingConfidence;
  source: string;
  recurring: boolean;
  overdue: boolean;
  /** funded = fits inside verified cash after higher-priority obligations */
  funded: boolean | null; // null when verified cash is unknown
  screenLink: string;
  note?: string;
}

export interface ObligationCalendar {
  items: Obligation[];
  next7: number;
  next14: number;
  next30: number;
  /** what rent/revenue-share would have been — shown as cheque deductions, NOT cash */
  chequeDeductionsNote: string;
  missing: string[];
}

/** Commitments from accepted owner actions (passed by the caller — I/O). */
export interface AcceptedCommitment { title: string; amount: number; dueDate: string | null }

export function buildObligationCalendar(s: StrategistSnapshot, accepted: AcceptedCommitment[] = []): ObligationCalendar {
  const items: Obligation[] = [];
  const missing: string[] = [];

  // Recurring cash costs, derived from categories present in both recent periods.
  // Rent is EXCLUDED — the mall deducts it from the cheque (see note below).
  for (const r of s.expenses.recurringMonthly.value ?? []) {
    if (/rent|ايجار/i.test(r.name)) continue; // deducted from the cheque, not cash
    items.push({
      name: r.name,
      amount: r.avgMonthly,
      due: { window: "next_30", label: "monthly (exact day not recorded)" },
      basis: "recurring_derived",
      confidence: "medium",
      source: s.expenses.recurringMonthly.source,
      recurring: true,
      overdue: false,
      funded: null,
      screenLink: "/expenses",
      note: r.isOperating ? undefined : "stock purchasing is semi-discretionary — it can be paced",
    });
  }
  if ((s.expenses.recurringMonthly.value ?? []).length === 0) {
    missing.push("no recurring expense pattern derivable yet (needs the same category in two consecutive periods)");
  }

  // Accepted owner actions with amounts
  for (const a of accepted) {
    items.push({
      name: a.title, amount: a.amount,
      due: a.dueDate ? { date: a.dueDate, label: a.dueDate } : { window: "next_30", label: "date not recorded" },
      basis: "accepted_action", confidence: "high", source: "strategist_actions (accepted)",
      recurring: false, overdue: a.dueDate != null && a.dueDate < s.meta.today, funded: null, screenLink: "/health",
    });
  }

  const rent = s.cheques.monthlyRentDeduction.value;
  const inWindow = (o: Obligation, days: number) => {
    if (o.due.date) {
      const d = Math.round((Date.parse(o.due.date) - Date.parse(s.meta.today)) / 86_400_000);
      return d <= days;
    }
    if (days >= 30) return true;                     // monthly windows count in 30d
    return o.due.window === "next_7" ? true : o.due.window === "next_14" ? days >= 14 : false;
  };
  const total = (days: number) => r0(items.filter((o) => inWindow(o, days)).reduce((a, o) => a + o.amount, 0));

  return {
    items: items.sort((a, b) => b.amount - a.amount),
    next7: total(7), next14: total(14), next30: total(30),
    chequeDeductionsNote: rent != null
      ? `Rent (${egp(rent)}/month) and the 3% revenue share are deducted from the settlement cheque by the mall — they reduce the EXPECTED CHEQUE, not drawer cash, and are already inside the net-expected figures.`
      : "Rent/revenue-share deductions are netted inside expected settlement figures.",
    missing,
  };
}

/* ═══ CASH STATE ══════════════════════════════════════════════════════ */

export interface CashState {
  /** 1. money available now */
  available: {
    verifiedCash: number | null;        // latest drawer count (null = never counted)
    countDate: string | null;
    countAgeDays: number | null;
    countIsStale: boolean;              // vs the owner's freshness limit
    accounts: null;                     // bank balances untracked (explicit)
    totalVerified: number | null;
    confidence: FindingConfidence;
    note: string;
  };
  /** 2. money expected but NOT available */
  expected: {
    ledgerExpected: number | null;      // opening anchor + cheques − expenses − purchases
    ledgerNote: string;
    openSettlementNet: number | null;   // estimated net of the open tab
    openSettlementGross: number | null;
    nextChequeEta: string | null;
    clearingNote: string;
  };
  /** 3. money committed */
  committed: { next7: number; next14: number; next30: number; items: Obligation[] };
  /** 4. untracked / uncertain dimensions */
  uncertain: string[];
  /** 5. owner movements (period) */
  owner: { withdrawals: number; injections: number | null; net: number | null; vsNetProfit: string };
  /** 6. safety */
  safety: {
    requiredReserve: number;
    reserveBasis: string;
    verifiedHeadroom: number | null;    // verified − committed(30) − reserve
    expectedHeadroom: number | null;    // ledger-expected based
    downsideHeadroom: number | null;    // expected minus the next cheque (delay scenario)
    discretionary: number | null;       // what could be spent without touching reserve
    verdict: "comfortable" | "adequate" | "tight" | "at_risk" | "unknowable";
    confidence: FindingConfidence;
    blockers: string[];
  };
}

export function computeReserve(s: StrategistSnapshot): { amount: number; basis: string } {
  const fixed = s.context.cashReserveFloor.value ?? 25_000;
  const type = s.context.reserveType.value ?? "higher_of_both";
  const monthlyOpex = (s.expenses.recurringMonthly.value ?? []).filter((r) => r.isOperating).reduce((a, r) => a + r.avgMonthly, 0)
    || (s.profit.operatingExpenses.value ?? 0);
  const days30 = r0(monthlyOpex); // ~30 days of operating costs
  const confirmed = s.context.cashReserveFloor.basis === "fact" ? "owner-confirmed" : "default";
  if (type === "fixed") return { amount: fixed, basis: `fixed floor ${egp(fixed)} (${confirmed})` };
  if (type === "days_of_costs") return { amount: days30, basis: `≈30 days of operating costs (${egp(days30)})` };
  return { amount: Math.max(fixed, days30), basis: `higher of the ${egp(fixed)} floor (${confirmed}) and ≈30 days of operating costs (${egp(days30)})` };
}

export function composeCashState(s: StrategistSnapshot, obligations: ObligationCalendar): CashState {
  const freshLimit = s.context.cashCountFreshnessDays.value ?? 7;
  const count = s.cash.latestCount.value;
  const countAge = s.cash.countAgeDays.value;
  const countIsStale = count != null && countAge != null && countAge > freshLimit;
  const verified = count != null && !countIsStale ? count : null;

  const uncertain: string[] = [];
  if (count == null) uncertain.push("no drawer count has ever been recorded — physical cash is unverified");
  else if (countIsStale) uncertain.push(`the last drawer count is ${countAge} days old (your freshness limit is ${freshLimit}) — treat it as history, not the present`);
  uncertain.push("bank/account balances are not tracked in BostaOS");
  uncertain.push("sale payment methods are untracked — revenue realizes as mall settlement cheques, so drawer cash cannot be derived from sales");
  uncertain.push("cheque clearing is not tracked — received cheque amounts are assumed banked");
  if (s.meta.isStale && s.meta.staleDays != null) uncertain.push(`books end ${s.meta.lastDataDate} (${s.meta.staleDays} days ago) — expected figures are as of that date`);

  const reserve = computeReserve(s);
  const committed30 = obligations.next30;
  const ledger = s.cash.expectedBalance.value;
  const openNet = s.cheques.openTabEstimatedNet.value;

  const verifiedHeadroom = verified != null ? r0(verified - committed30 - reserve.amount) : null;
  const expectedHeadroom = ledger != null ? r0(ledger - committed30 - reserve.amount) : null;
  // downside: the next cheque slips past the horizon → expected position loses the open tab
  const downsideHeadroom = ledger != null ? r0(ledger - (openNet ?? 0) - committed30 - reserve.amount) : null;

  const blockers: string[] = [];
  if (verified == null) blockers.push(count == null ? "record the first drawer count" : "record a fresh drawer count");
  if (s.meta.isStale) blockers.push(`bring the books current (they end ${s.meta.lastDataDate})`);

  let verdict: CashState["safety"]["verdict"];
  if (verified == null && ledger == null) verdict = "unknowable";
  else if (verified != null) {
    verdict = verifiedHeadroom! >= reserve.amount ? "comfortable" : verifiedHeadroom! >= 0 ? "adequate" : verifiedHeadroom! > -reserve.amount / 2 ? "tight" : "at_risk";
  } else {
    // only the ledger expectation exists — one level less certain, and unknowable stays honest
    verdict = "unknowable";
  }

  const netProfit = s.profit.netProfit.value;
  const wd = s.cash.withdrawals.value ?? 0;

  return {
    available: {
      verifiedCash: verified,
      countDate: s.cash.lastCountDate.value,
      countAgeDays: countAge,
      countIsStale,
      accounts: null,
      totalVerified: verified,
      confidence: verified != null ? "high" : "none" as FindingConfidence,
      note: verified != null
        ? `drawer counted ${egp(verified)} on ${s.cash.lastCountDate.value}`
        : count != null
          ? `last count (${egp(count)}) is stale — current physical cash is unverified`
          : "physical cash has never been counted",
    },
    expected: {
      ledgerExpected: ledger,
      ledgerNote: s.cash.expectedBalance.note ?? "opening anchor + cheques − expenses − purchases",
      openSettlementNet: openNet,
      openSettlementGross: s.cheques.openTabGross.value,
      nextChequeEta: s.cheques.nextChequeEta.value,
      clearingNote: "an expected cheque is NOT available cash; a received cheque is assumed banked (clearing untracked)",
    },
    committed: { next7: obligations.next7, next14: obligations.next14, next30: obligations.next30, items: obligations.items },
    uncertain,
    owner: {
      withdrawals: r0(wd),
      injections: s.cash.injections.value,
      net: s.cash.injections.value != null ? r0((s.cash.injections.value ?? 0) - wd) : (wd > 0 ? r0(-wd) : null),
      vsNetProfit: netProfit != null
        ? `withdrawals are ${netProfit > 0 ? `${Math.round((wd / netProfit) * 100)}% of` : "set against"} the period's net profit (${egp(netProfit)})`
        : "net profit is withheld this period — no profit comparison possible",
    },
    safety: {
      requiredReserve: reserve.amount,
      reserveBasis: reserve.basis,
      verifiedHeadroom, expectedHeadroom, downsideHeadroom,
      discretionary: verifiedHeadroom != null ? Math.max(0, verifiedHeadroom) : null,
      verdict,
      confidence: verified != null && !s.meta.isStale ? "high" : verified != null || ledger != null ? "low" : "none" as FindingConfidence,
      blockers,
    },
  };
}

/* ═══ CASH FINDINGS (merged into the ranked report) ═══════════════════ */

function cashFinding(
  id: string, cls: Finding["class"], title: string, detail: string, evidence: Evidence[],
  opts: Partial<Pick<Finding, "impactEgp" | "urgency" | "confidence" | "missingData" | "resolutionCriteria" | "assumptions">> & { action?: { title: string; action: string; rationale: string; screenLink: string; urgency?: Urgency } },
): Finding {
  return {
    id, class: cls, title, detail, evidence,
    impactEgp: opts.impactEgp ?? null,
    urgency: opts.urgency ?? "this_week",
    confidence: opts.confidence ?? "high",
    actionable: !!opts.action,
    action: opts.action ? {
      title: opts.action.title, action: opts.action.action, rationale: opts.action.rationale,
      expectedImpact: "cash position becomes verifiable", urgency: opts.action.urgency ?? "this_week",
      confidence: opts.confidence ?? "high", screenLink: opts.action.screenLink,
      missingData: [], caveats: [], reversible: true,
    } : null,
    alternativeAction: null,
    missingData: opts.missingData ?? [],
    drivers: [], assumptions: opts.assumptions ?? [],
    resolutionCriteria: opts.resolutionCriteria ?? "the engine stops raising this on a newer snapshot",
    persistEligible: false, score: 0, rank: 0,
  };
}

export function cashFindings(s: StrategistSnapshot, cash: CashState, obligations: ObligationCalendar): Finding[] {
  const out: Finding[] = [];

  // first / stale count — replaces the generic cash-not-tracked finding
  if (cash.available.verifiedCash == null) {
    const never = cash.available.countDate == null;
    out.push(cashFinding(
      never ? "cash-count-required" : "cash-count-stale", "data_quality",
      never ? "Cash cannot be reconciled until the first verified count" : `The drawer count is ${cash.available.countAgeDays} days old`,
      never
        ? "Profit, cheques and expected movements are still analysed — but withdrawals, affordability and the cash forecast stay 'unknowable' until a physical count anchors reality."
        : "Beyond your freshness limit a count is history, not the present. Verified headroom is withheld until a fresh count.",
      [ev("Latest count", s.cash.latestCount), ev("Ledger-expected cash", s.cash.expectedBalance)],
      {
        urgency: "this_week",
        resolutionCriteria: "a drawer count within the freshness limit exists",
        action: { title: never ? "Record the first drawer count" : "Re-count the drawer", action: "Count the drawer once (Money → Count cash) — every cash answer upgrades immediately.", rationale: "One count turns verified cash, headroom and affordability from 'unknowable' into numbers.", screenLink: "/money" },
      },
    ));
  }

  // unfunded obligations horizon
  if (cash.available.verifiedCash != null && obligations.next30 > cash.available.verifiedCash) {
    out.push(cashFinding(
      "obligations-unfunded", "warning",
      `The next 30 days of obligations (${egp(obligations.next30)}) exceed verified cash (${egp(cash.available.verifiedCash)})`,
      `Funding depends on the settlement pipe arriving on time${cash.expected.nextChequeEta ? ` (next cheque ~${cash.expected.nextChequeEta})` : ""}. ${obligations.chequeDeductionsNote}`,
      [ev("Committed (30d)", { value: obligations.next30, source: "obligation calendar", period: "next 30d", basis: "calculated", confidence: "medium", completeness: null, screenLink: "/expenses" } as never), ev("Verified cash", s.cash.latestCount)],
      { impactEgp: r0(obligations.next30 - cash.available.verifiedCash), urgency: "this_week", confidence: "medium", resolutionCriteria: "verified cash covers the 30-day obligations" },
    ));
  }

  // reserve breach risk on the expected path
  if (cash.safety.expectedHeadroom != null && cash.safety.expectedHeadroom < 0) {
    out.push(cashFinding(
      "reserve-breach-risk", "warning",
      `Expected cash sits ${egp(Math.abs(cash.safety.expectedHeadroom))} below the reserve after obligations`,
      `Reserve: ${cash.safety.reserveBasis}. ${cash.expected.clearingNote}`,
      [ev("Ledger-expected cash", s.cash.expectedBalance), ev("Open settlement (net est.)", s.cheques.openTabEstimatedNet)],
      { impactEgp: Math.abs(cash.safety.expectedHeadroom), urgency: "this_week", confidence: "medium", resolutionCriteria: "expected headroom back above zero" },
    ));
  }

  // concentration: the expected money is (as always for a concession) one cheque
  const openNet = cash.expected.openSettlementNet;
  if (openNet != null && openNet > 0 && (s.cash.expectedBalance.value == null || openNet > (s.cash.expectedBalance.value ?? 0) * 0.5)) {
    out.push(cashFinding(
      "cheque-concentration", "fact",
      `${egp(openNet)} of expected money hangs on a single mall cheque`,
      `All revenue settles through one counterparty. A delay moves your whole inflow${cash.expected.nextChequeEta ? `; historical rhythm suggests ~${cash.expected.nextChequeEta}` : ""}.`,
      [ev("Open tab (net est.)", s.cheques.openTabEstimatedNet), ev("Next cheque ETA", s.cheques.nextChequeEta, (v) => String(v))],
      { urgency: "monitor", confidence: "high" },
    ));
  }

  return out;
}
