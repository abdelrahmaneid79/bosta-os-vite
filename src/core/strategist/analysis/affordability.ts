/** General affordability engine — PURE (Cycle 7).
 *
 *  One deterministic engine for: owner withdrawal, one-time purchase,
 *  recurring cost, employee hire. CASH SAFETY FIRST: profit provides
 *  context but can never override liquidity. Expected money can fund an
 *  OPTIONAL spend only if the owner explicitly allowed that in Tune.
 *
 *  No expected revenue benefit is ever assumed — a benefit exists only as
 *  an explicit owner scenario assumption. */
import type { StrategistSnapshot } from "../contract";
import type { FindingConfidence } from "./types";
import type { CashState } from "./cash";

const r0 = (n: number) => Math.round(n);
const egp = (n: number) => `EGP ${Math.round(n).toLocaleString("en-US")}`;

export type AffordabilityVerdict =
  | "safe" | "safe_reduces_flexibility" | "conditional" | "tight" | "unsafe" | "unknowable";

export interface AffordabilityRequest {
  kind: "withdrawal" | "purchase" | "equipment" | "employee" | "marketing" | "one_time_expense" | "recurring_expense";
  upfront: number;                 // EGP now
  recurringMonthly?: number;       // EGP per month (employee salary, subscription…)
  durationMonths?: number | null;  // null = open-ended
  mandatory?: boolean;             // must-have vs optional
  reversible?: boolean;
  label?: string;
}

export interface AffordabilityAssessment {
  request: AffordabilityRequest;
  verdict: AffordabilityVerdict;
  answerLevel: "verified" | "conditional" | "unknowable";
  /** the separated money view — never one number */
  verifiedCash: number | null;
  expectedUnavailable: number | null;   // settlement pipe (NOT spendable yet)
  committed30: number;
  requiredReserve: number;
  verifiedHeadroom: number | null;
  conditionalHeadroom: number | null;   // ledger-expected based
  afterSpend: { verifiedHeadroom: number | null; conditionalHeadroom: number | null };
  /** recurring analysis */
  recurring: null | {
    monthly: number;
    annual: number;
    revenueToCover: number | null;      // at current gross margin
    marginBasis: string;
    monthsCoverableFromHeadroom: number | null;
    sustainable: boolean | null;
  };
  profitContext: string;
  reasons: string[];
  assumptions: string[];
  missing: string[];
  confidence: FindingConfidence;
  recommendedMax: number | null;        // for the upfront component
  nextStep: string;
}

export function assessAffordability(s: StrategistSnapshot, cash: CashState, req: AffordabilityRequest): AffordabilityAssessment {
  const reasons: string[] = [];
  const assumptions: string[] = [];
  const missing: string[] = [...cash.safety.blockers];

  const verified = cash.available.totalVerified;
  const expected = cash.expected.openSettlementNet;
  const reserve = cash.safety.requiredReserve;
  const committed30 = cash.committed.next30;
  const vHead = cash.safety.verifiedHeadroom;
  const cHead = cash.safety.expectedHeadroom;
  const allowExpectedForOptional = s.context.allowExpectedCashForOptional.value ?? false;

  const upfront = Math.max(0, req.upfront);
  const monthly = Math.max(0, req.recurringMonthly ?? 0);

  /* recurring sustainability — margin-based revenue requirement, no benefit assumed */
  let recurring: AffordabilityAssessment["recurring"] = null;
  if (monthly > 0) {
    const margin = s.profit.grossMarginPct.value;
    const revenueToCover = margin != null && margin > 0 ? r0(monthly / (margin / 100)) : null;
    const headForMonths = cHead ?? vHead;
    recurring = {
      monthly, annual: r0(monthly * 12),
      revenueToCover,
      marginBasis: margin != null
        ? `at the measured ${margin}% gross margin (covered revenue only)`
        : "gross margin is withheld this period — the revenue requirement is unknowable",
      monthsCoverableFromHeadroom: headForMonths != null && headForMonths > 0 ? Math.floor(headForMonths / monthly) : null,
      sustainable: s.profit.netProfit.value != null ? s.profit.netProfit.value >= monthly : null,
    };
    if (revenueToCover != null) assumptions.push(`covering ${egp(monthly)}/month needs ~${egp(revenueToCover)}/month of extra sales ${recurring.marginBasis} — no revenue benefit is assumed`);
    if (recurring.sustainable === false) reasons.push(`current net profit (${egp(s.profit.netProfit.value!)}) does not cover the recurring ${egp(monthly)}/month on its own`);
    if (recurring.sustainable == null) missing.push("net profit withheld — recurring sustainability cannot be judged from profit");
  }

  /* verdict — cash first */
  const optional = !(req.mandatory ?? false);
  let answerLevel: AffordabilityAssessment["answerLevel"];
  let verdict: AffordabilityVerdict;

  if (verified == null) {
    // no verified cash — optional spends are unknowable; a conditional answer
    // exists only if the owner allowed expected-cash reasoning (or it's mandatory)
    if ((allowExpectedForOptional || !optional) && cHead != null) {
      answerLevel = "conditional";
      const after = cHead - upfront;
      verdict = after >= 0 ? "conditional" : "unsafe";
      reasons.push(`based on EXPECTED cash only (${cash.expected.ledgerNote}) — no verified count exists`);
      if (after < 0) reasons.push(`the spend would push expected headroom ${egp(Math.abs(after))} below the reserve`);
    } else {
      answerLevel = "unknowable";
      verdict = "unknowable";
      reasons.push("no verified cash baseline — an optional spend cannot be sized against money that hasn't been counted");
      if (!allowExpectedForOptional && optional && cHead != null) reasons.push("(Tune allows switching optional spends to expected-cash reasoning — off by default)");
    }
  } else {
    answerLevel = "verified";
    const after = (vHead ?? 0) - upfront;
    if (after >= reserve * 0.5) verdict = "safe";
    else if (after >= 0) verdict = "safe_reduces_flexibility";
    else if (cHead != null && cHead - upfront >= 0) { verdict = "conditional"; reasons.push("verified cash alone can't fund it, but the expected settlement covers it — timing risk on the mall cheque"); }
    else if (after > -reserve / 2) verdict = "tight";
    else verdict = "unsafe";
    if (verdict === "unsafe") reasons.push(`the spend breaks the reserve by ${egp(Math.abs(after))} even before recurring costs`);
  }
  if (monthly > 0 && recurring?.sustainable === false && verdict !== "unknowable" && verdict !== "unsafe") {
    verdict = verdict === "safe" ? "conditional" : verdict;
    reasons.push("the recurring cost outruns current net profit — it survives only by consuming headroom");
  }
  if (cash.expected.nextChequeEta && verdict === "conditional") assumptions.push(`assumes the next mall cheque lands ~${cash.expected.nextChequeEta} (historical rhythm, not a promise)`);
  if (s.meta.isStale) assumptions.push(`books end ${s.meta.lastDataDate} — the position may have moved since`);

  const confidence: FindingConfidence =
    answerLevel === "verified" && !s.meta.isStale ? "high"
    : answerLevel === "conditional" ? "low"
    : "low";

  const recommendedMax = vHead != null ? Math.max(0, vHead) : (allowExpectedForOptional || !optional) && cHead != null ? Math.max(0, cHead) : null;

  const nextStep =
    verdict === "unknowable" ? (cash.available.countDate == null ? "Record the first drawer count, then re-run this." : "Record a fresh drawer count, then re-run this.")
    : verdict === "unsafe" ? "Don't proceed at this size — wait for the next cheque or reduce the amount."
    : verdict === "conditional" ? "Proceed only after the expected cheque lands, or stage the spend."
    : monthly > 0 ? "Proceed, and re-check after the first month's real cost hits the books."
    : "Proceed — and record the spend so the books stay honest.";

  return {
    request: req, verdict, answerLevel,
    verifiedCash: verified,
    expectedUnavailable: expected,
    committed30, requiredReserve: reserve,
    verifiedHeadroom: vHead, conditionalHeadroom: cHead,
    afterSpend: {
      verifiedHeadroom: vHead != null ? r0(vHead - upfront) : null,
      conditionalHeadroom: cHead != null ? r0(cHead - upfront) : null,
    },
    recurring,
    profitContext: s.profit.netProfit.value != null
      ? `net profit ${egp(s.profit.netProfit.value)} this period — context only; liquidity decides`
      : "net profit withheld (incomplete cost coverage) — liquidity decides alone",
    reasons, assumptions, missing,
    confidence, recommendedMax, nextStep,
  };
}

/* ═══ WITHDRAWAL V2 — a thin, owner-language wrapper over the engine ═══ */

export interface WithdrawalAssessmentV2 {
  amount: number;
  verdict: AffordabilityVerdict;
  answerLevel: "verified" | "conditional" | "unknowable";
  verifiedCash: string;
  expectedMoney: string;
  committed: string;
  reserve: string;
  verifiedHeadroom: string;
  resultingReserve: string;
  profitContext: string;
  withdrawalsAlready: string;
  dataFreshness: string;
  recommendedMax: number | null;
  reasonsToWait: string[];
  confidence: FindingConfidence;
  nextStep: string;
}

export function assessWithdrawalV2(s: StrategistSnapshot, cash: CashState, amount: number): WithdrawalAssessmentV2 {
  // a withdrawal is always OPTIONAL and must clear verified cash by default
  const a = assessAffordability(s, cash, { kind: "withdrawal", upfront: amount, mandatory: false, reversible: false, label: "owner withdrawal" });
  const reasons = [...a.reasons];
  const wd = cash.owner.withdrawals;
  if (wd > 0) reasons.push(`you have already withdrawn ${egp(wd)} this period (${cash.owner.vsNetProfit}).`);
  if ((cash.expected.openSettlementNet ?? 0) > 0) reasons.push(`~${egp(cash.expected.openSettlementNet!)} is still parked at the mall — waiting for that cheque widens headroom.`);

  return {
    amount,
    verdict: a.verdict,
    answerLevel: a.answerLevel,
    verifiedCash: cash.available.note,
    expectedMoney: a.expectedUnavailable != null
      ? `~${egp(a.expectedUnavailable)} expected from the open settlement (NOT available until the cheque arrives${cash.expected.nextChequeEta ? `, ETA ~${cash.expected.nextChequeEta}` : ""})`
      : "no measurable settlement pipe right now",
    committed: `${egp(a.committed30)} committed over the next 30 days (${cash.committed.items.slice(0, 3).map((o) => o.name).join(", ") || "no recorded obligations"})`,
    reserve: `${egp(a.requiredReserve)} — ${cash.safety.reserveBasis}`,
    verifiedHeadroom: a.verifiedHeadroom != null ? `${egp(a.verifiedHeadroom)} above reserve after obligations` : "unknowable without a fresh drawer count",
    resultingReserve: a.afterSpend.verifiedHeadroom != null
      ? (a.afterSpend.verifiedHeadroom >= 0 ? `${egp(a.afterSpend.verifiedHeadroom)} of headroom would remain` : `the reserve would be breached by ${egp(Math.abs(a.afterSpend.verifiedHeadroom))}`)
      : a.afterSpend.conditionalHeadroom != null
        ? `on EXPECTED cash: ${a.afterSpend.conditionalHeadroom >= 0 ? `${egp(a.afterSpend.conditionalHeadroom)} would remain` : `breach of ${egp(Math.abs(a.afterSpend.conditionalHeadroom))}`}`
        : "cannot be computed",
    profitContext: a.profitContext,
    withdrawalsAlready: wd > 0 ? `${egp(wd)} withdrawn this period` : "no withdrawals recorded this period",
    dataFreshness: s.meta.lastDataDate
      ? `books to ${s.meta.lastDataDate}${s.meta.isStale ? ` — ${s.meta.staleDays} days behind` : ""}; ${cash.available.countDate ? `drawer counted ${cash.available.countDate}` : "drawer never counted"}`
      : "no sales data",
    recommendedMax: a.recommendedMax,
    reasonsToWait: reasons,
    confidence: a.confidence,
    nextStep: a.nextStep,
  };
}
