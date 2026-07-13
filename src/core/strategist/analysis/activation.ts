/** Operational activation — PURE Layer 2 (Cycle 8).
 *
 *  Turns "unknowable" into "known" by telling the owner exactly what to
 *  record, in what order, and what each step unlocks. Never fabricates a
 *  baseline; the current unknowable answers stay correct until real records
 *  exist. Distinguishes historical completeness from LIVE completeness so old
 *  partial imports never nag or tank the score. */
import type { StrategistSnapshot } from "../contract";
import type { Finding } from "./types";

export type StepStatus = "done" | "pending" | "optional_pending";

export interface ActivationStep {
  key: string;
  title: string;
  why: string;
  status: StepStatus;
  action: string;
  effort: "low" | "medium" | "high";
  screenLink: string;
  unlocks: string[];
  required: boolean;
}

export type ReadinessState =
  | "historical_only"        // nothing live confirmed yet
  | "activation_incomplete"  // started, required steps remain
  | "live_partial"           // live but some verification missing
  | "live_operational"       // all required live baselines exist
  | "live_verified";         // + fresh counts, current books

export interface ActivationChecklist {
  steps: ActivationStep[];
  requiredRemaining: number;
  optionalRemaining: number;
  readiness: ReadinessState;
  readinessReason: string;
  /** the single highest-value next step (required first) */
  nextStep: ActivationStep | null;
  liveStartConfirmed: boolean;
}

export function buildActivationChecklist(s: StrategistSnapshot): ActivationChecklist {
  const lo = s.meta.liveOps;
  const cashCounted = s.cash.latestCount.value != null;
  const stockCounted = s.inventory.hasLiveData;
  const reserveConfirmed = s.context.cashReserveFloor.basis === "fact";
  const salesCurrent = !s.meta.isStale;
  const closeCurrent = lo.lastCloseDate != null && s.meta.lastDataDate != null && lo.lastCloseDate >= s.meta.lastDataDate;

  const step = (
    key: string, title: string, why: string, done: boolean, action: string,
    effort: ActivationStep["effort"], screenLink: string, unlocks: string[], required = true,
  ): ActivationStep => ({
    key, title, why,
    status: done ? "done" : required ? "pending" : "optional_pending",
    action, effort, screenLink, unlocks, required,
  });

  const steps: ActivationStep[] = [
    step("live_start", "Confirm your live-operations start date",
      "This is the day BostaOS begins expecting complete daily records. History before it stays historical — never nagged.",
      lo.basis === "confirmed", "Pick the date you'll start recording every day and confirm it.",
      "low", "/settings/opening",
      ["stops missing-data nagging for old imported history", "anchors the live health score"]),
    step("first_cash", "Record the first drawer cash count",
      "Prior expected cash is a ledger guess, not verified physical cash. One count establishes the baseline.",
      cashCounted, "Count the drawer once and enter it as the opening baseline.",
      "low", "/money",
      ["verified cash", "withdrawal decisions", "cash reconciliation", "absolute cash forecasts", "verified runway"]),
    step("bank_balance", "Record bank/other liquid balance (if any)",
      "If money also sits in a bank, tracking it completes the available-cash picture.",
      false, "Enter the bank balance alongside the drawer count, or skip if all cash is in the drawer.",
      "low", "/money",
      ["fuller available-cash total"], false),
    step("cheque_status", "Confirm the current open cheque position",
      "Expected settlement money depends on which cheques are still outstanding.",
      s.cheques.lastChequeDate.value != null, "Review cheques and confirm the latest is recorded.",
      "low", "/cheques",
      ["accurate expected-money block", "next-cheque timing"]),
    step("first_stock", "Record the first stock count",
      "Historical inventory movements don't reconcile to what's physically on the shelf. A count sets the opening baseline.",
      stockCounted, "Count current stock by product (weight or pieces) as the opening baseline.",
      "medium", "/settings/opening",
      ["live inventory", "days of cover", "purchase quantities", "stock-risk & excess alerts"]),
    step("catch_up_sales", "Enter or import current sales",
      `Live books stop at ${s.meta.lastDataDate ?? "an earlier date"}. Recent days need entering before today's numbers mean anything.`,
      salesCurrent, "Enter or import the sales days since the last recorded date (or mark closed days).",
      "medium", "/sales/import",
      ["current revenue", "trustworthy trends", "current cash expectation"]),
    step("reserve_policy", "Confirm your cash reserve policy",
      "The reserve is the floor every affordability answer protects. Confirm it so decisions use your number, not a default.",
      reserveConfirmed, "Set your minimum safe cash reserve in Tune.",
      "low", "/health",
      ["your-number affordability verdicts (not defaults)"]),
    step("first_close", "Complete your first daily close",
      "The daily close is the habit that keeps every live answer current with a few minutes' work.",
      closeCurrent, "Run the daily close for the most recent trading day.",
      "low", "/health",
      ["ongoing live confidence", "daily readiness tracking"]),
  ];

  const requiredRemaining = steps.filter((x) => x.required && x.status !== "done").length;
  const optionalRemaining = steps.filter((x) => !x.required && x.status !== "done").length;

  let readiness: ReadinessState;
  let readinessReason: string;
  if (lo.basis === "unset" && !cashCounted && !stockCounted) {
    readiness = "historical_only";
    readinessReason = "No live operations started — BostaOS is analysing historical data only.";
  } else if (requiredRemaining > 0) {
    readiness = "activation_incomplete";
    readinessReason = `${requiredRemaining} required activation step(s) remain before live answers can be trusted.`;
  } else if (!salesCurrent || (cashCounted && (s.cash.countAgeDays.value ?? 0) > (s.context.cashCountFreshnessDays.value ?? 7))) {
    readiness = "live_partial";
    readinessReason = "All baselines exist, but some records are stale — verification is partial.";
  } else if (stockCounted && cashCounted && salesCurrent) {
    readiness = "live_verified";
    readinessReason = "Live, current and verified — all intelligence is fully active.";
  } else {
    readiness = "live_operational";
    readinessReason = "Live and operational; strong verification will come with fresh counts.";
  }

  const nextStep = steps.find((x) => x.required && x.status !== "done")
    ?? steps.find((x) => !x.required && x.status !== "done")
    ?? null;

  return {
    steps, requiredRemaining, optionalRemaining,
    readiness, readinessReason, nextStep,
    liveStartConfirmed: lo.basis === "confirmed",
  };
}

/* ═══ ACTIVATION FINDINGS — ranked with everything else ═══════════════ */

function actFinding(id: string, title: string, detail: string, action: string, screenLink: string, unlocks: string[], urgency: Finding["urgency"] = "this_week"): Finding {
  return {
    id, class: "data_quality", title, detail,
    evidence: [{ label: "Unlocks", value: unlocks.join(", "), source: "activation checklist", period: "now", screenLink }],
    impactEgp: null, urgency, confidence: "high",
    actionable: true,
    action: { title, action, rationale: `Unlocks: ${unlocks.join(", ")}.`, expectedImpact: "activates blocked intelligence", urgency, confidence: "high", screenLink, missingData: [], caveats: [], reversible: true },
    alternativeAction: null, missingData: [], drivers: [], assumptions: [],
    resolutionCriteria: "the corresponding baseline record exists", persistEligible: false, score: 0, rank: 0,
  };
}

/** Until the system is operational, the highest-value activation step should
 *  usually outrank product/pricing optimisation — encoded as data_quality
 *  findings with this-week urgency that the weekly priority already favours. */
export function activationFindings(_s: StrategistSnapshot, checklist: ActivationChecklist): Finding[] {
  if (checklist.readiness === "live_operational" || checklist.readiness === "live_verified") return [];
  const out: Finding[] = [];
  const next = checklist.nextStep;
  if (next && next.required) {
    out.push(actFinding(
      `activate-${next.key}`, `Activate BostaOS: ${next.title.toLowerCase()}`,
      `${next.why} ${checklist.requiredRemaining} required step(s) remain.`,
      next.action, next.screenLink, next.unlocks, "this_week",
    ));
  }
  return out;
}
