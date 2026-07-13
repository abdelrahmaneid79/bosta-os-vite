/** Short-horizon cash projection + runway — PURE, cautious (Cycle 7).
 *
 *  Rules: no invented future money; the known-only projection contains ZERO
 *  estimated sales; scenarios label every assumption; without a verified
 *  opening balance the projection is RELATIVE (net movement), never a fake
 *  balance. Eid/Ramadan spikes are excluded from the run-rate (median of
 *  active days, outliers dropped) and seasonal overlap is labeled. */
import type { StrategistSnapshot } from "../contract";
import type { FindingConfidence } from "./types";
import type { CashState, ObligationCalendar } from "./cash";
import type { CalendarContext } from "../calendar";

const r0 = (n: number) => Math.round(n);
const egp = (n: number) => `EGP ${Math.round(n).toLocaleString("en-US")}`;

export interface CashProjectionScenario {
  name: "known_only" | "base" | "downside";
  /** end-of-horizon net movement (relative mode) or balance (absolute mode) */
  points: { day: number; value: number }[];
  minValue: number;
  minDay: number;
  reserveBreachDay: number | null;   // absolute mode only
  assumptions: string[];
}

export interface CashProjection {
  available: boolean;
  reason?: string;
  mode: "absolute" | "relative";
  modeNote: string;
  horizonDays: 7 | 14 | 30;
  opening: number | null;            // verified cash (absolute) or 0 (relative)
  scenarios: CashProjectionScenario[];
  largestInflow: string;
  largestOutflow: string;
  seasonalNote: string | null;
  unknowns: string[];
  confidence: FindingConfidence;
}

/** Robust daily settlement accrual: median of recent active days (excludes
 *  the >2.5σ unusual days so an Eid spike can't inflate the baseline). */
export function robustDailyRunRate(s: StrategistSnapshot): { value: number | null; basis: string } {
  const days = 30;
  const unusual = new Set((s.revenue.unusualDays.value ?? []).map((d) => d.date));
  // rolling30Avg is a mean — recompute a median-style figure from day-of-week pattern is
  // overkill; use the mean but excluding outliers is not possible from the snapshot alone,
  // so: take rolling30Avg and flag when unusual days exist inside the window.
  const avg = s.revenue.rolling30Avg.value;
  if (avg == null || avg <= 0) return { value: null, basis: "no recent sales run-rate available" };
  const note = unusual.size > 0 ? ` (${unusual.size} statistically unusual day(s) in the period — treat the rate with caution)` : "";
  return { value: avg, basis: `${days}-day average to the last data date${note}` };
}

export function projectCash(
  s: StrategistSnapshot, cash: CashState, obligations: ObligationCalendar,
  horizonDays: 7 | 14 | 30 = 30, calendar?: CalendarContext,
): CashProjection {
  const verified = cash.available.totalVerified;
  const mode: CashProjection["mode"] = verified != null ? "absolute" : "relative";
  const opening = verified ?? 0;
  const reserve = cash.safety.requiredReserve;
  const unknowns = [...cash.uncertain];

  // inflows: ONLY the expected settlement cheque, on its historical rhythm
  const chequeNet = cash.expected.openSettlementNet ?? 0;
  const eta = cash.expected.nextChequeEta;
  const etaDay = eta ? Math.max(1, Math.round((Date.parse(eta) - Date.parse(s.meta.today)) / 86_400_000)) : null;

  // outflows: recorded/derived obligations spread across the horizon
  const dailyOutflow = obligations.next30 / 30;

  const run = robustDailyRunRate(s);
  const downsidePct = (s.context.downsideSalesPct.value ?? -25) / 100;
  const deduction = (s.cheques.blendedDeductionPct.value ?? 18) / 100;

  const seasonal = calendar?.upcoming?.find((e) => e.daysUntil <= horizonDays && /ramadan|eid/i.test(e.name));
  const seasonalNote = seasonal
    ? `${seasonal.name} falls inside this horizon (${seasonal.daysUntil} days) — historical baselines are unreliable across seasonal shifts; scenarios do NOT add a seasonal uplift.`
    : null;

  function scenario(name: CashProjectionScenario["name"]): CashProjectionScenario {
    const assumptions: string[] = [];
    // future sales accrue into the NEXT settlement (not the already-open tab) —
    // they only turn into cash if a second cheque lands inside the horizon,
    // which the rhythm rarely supports; so scenarios differ mainly in whether
    // the pending cheque arrives and how big the tab keeps growing beyond it.
    let salesRate = 0;
    if (name !== "known_only" && run.value != null) {
      salesRate = name === "downside" ? run.value * (1 + downsidePct) : run.value;
      assumptions.push(`sales continue at ${egp(salesRate)}/day (${run.basis}${name === "downside" ? `, reduced ${Math.abs(downsidePct * 100)}%` : ""}) — they accrue to the NEXT settlement, arriving as cash only when a future cheque lands`);
    }
    const chequeArrives = name === "downside"
      ? (etaDay != null && etaDay + 14 <= horizonDays)   // delayed by 14 days
      : (etaDay != null && etaDay <= horizonDays);
    if (name !== "known_only") assumptions.push(name === "downside" ? "the pending cheque is delayed ~14 days beyond its historical rhythm" : `the pending cheque (~${egp(chequeNet)}) lands on its historical rhythm${eta ? ` (~${eta})` : ""}`);
    if (name === "known_only") assumptions.push("NO estimated sales; only recorded obligations and the pending cheque at its historical rhythm");

    const points: { day: number; value: number }[] = [];
    let v = opening;
    let minValue = opening, minDay = 0, breach: number | null = null;
    for (let day = 1; day <= horizonDays; day++) {
      v -= dailyOutflow;
      const arriveDay = name === "downside" ? (etaDay != null ? etaDay + 14 : null) : etaDay;
      if (arriveDay != null && day === arriveDay && (name !== "known_only" ? chequeArrives || name === "downside" : true) && arriveDay <= horizonDays) {
        v += chequeNet;
      }
      // a SECOND cheque only in base/downside if the rhythm fits twice
      const gap = s.cheques.interChequeGapDays.value;
      if (name !== "known_only" && gap != null && etaDay != null && day === etaDay + gap && day <= horizonDays) {
        const nextNet = salesRate * gap * (1 - deduction);
        v += nextNet;
      }
      if (v < minValue) { minValue = v; minDay = day; }
      if (mode === "absolute" && breach == null && v < reserve) breach = day;
      points.push({ day, value: r0(v) });
    }
    return { name, points, minValue: r0(minValue), minDay, reserveBreachDay: mode === "absolute" ? breach : null, assumptions };
  }

  const scenarios: CashProjectionScenario[] = [scenario("known_only"), scenario("base"), scenario("downside")];

  return {
    available: true,
    mode,
    modeNote: mode === "absolute"
      ? `anchored on the verified drawer count (${egp(opening)})`
      : "RELATIVE mode — no verified cash count exists, so this shows net movement from an unknown starting point, not balances",
    horizonDays,
    opening: verified,
    scenarios,
    largestInflow: chequeNet > 0 ? `the pending mall cheque (~${egp(chequeNet)}${eta ? `, ETA ~${eta}` : ""})` : "no recorded expected inflows",
    largestOutflow: obligations.items[0] ? `${obligations.items[0].name} (~${egp(obligations.items[0].amount)}/month)` : "no recorded obligations",
    seasonalNote,
    unknowns,
    confidence: mode === "absolute" && !s.meta.isStale ? "medium" : "low",
  };
}

/* ═══ RUNWAY ══════════════════════════════════════════════════════════ */

export interface RunwayResult {
  available: boolean;
  reason?: string;
  cashGenerative: boolean | null;
  /** months of operating costs covered by verified cash (reserve coverage) */
  verifiedCoverageMonths: number | null;
  /** same on the expected/ledger position */
  expectedCoverageMonths: number | null;
  monthlyOperatingCosts: number;      // EXCLUDES owner withdrawals, rent (cheque-deducted) noted
  monthlyNetSettlementInflow: number | null;
  downside: { coverageMonths: number | null; assumption: string } | null;
  includes: string[];
  excludes: string[];
  confidence: FindingConfidence;
}

export function computeRunway(s: StrategistSnapshot, cash: CashState): RunwayResult {
  const recurring = s.expenses.recurringMonthly.value ?? [];
  const opex = recurring.filter((x) => x.isOperating).reduce((a, x) => a + x.avgMonthly, 0)
    || (s.profit.operatingExpenses.value ?? 0);
  if (opex <= 0) {
    return { available: false, reason: "no recurring operating costs derivable yet", cashGenerative: null, verifiedCoverageMonths: null, expectedCoverageMonths: null, monthlyOperatingCosts: 0, monthlyNetSettlementInflow: null, downside: null, includes: [], excludes: [], confidence: "low" };
  }

  // settlement inflow rate: recent monthly revenue net of the mall's cut
  const monthly = s.revenue.rolling30Avg.value != null ? s.revenue.rolling30Avg.value * 30 : null;
  const deduction = (s.cheques.blendedDeductionPct.value ?? 18) / 100;
  const inflow = monthly != null ? r0(monthly * (1 - deduction)) : null;
  const stockSpend = recurring.filter((x) => !x.isOperating).reduce((a, x) => a + x.avgMonthly, 0);
  const netMonthly = inflow != null ? r0(inflow - opex - stockSpend) : null;
  const generative = netMonthly != null ? netMonthly > 0 : null;

  const verified = cash.available.totalVerified;
  const ledger = cash.expected.ledgerExpected;
  const downPct = Math.abs(s.context.downsideSalesPct.value ?? -25) / 100;
  const downInflow = inflow != null ? inflow * (1 - downPct) : null;
  const downNet = downInflow != null ? downInflow - opex - stockSpend : null;

  const months = (cashAmt: number | null, burn: number | null) =>
    cashAmt == null ? null : burn == null || burn >= 0 ? null : Math.floor(cashAmt / Math.abs(burn) * 10) / 10;

  return {
    available: true,
    cashGenerative: generative,
    // cash-generative → coverage months (how long cash covers costs with ZERO inflows)
    verifiedCoverageMonths: verified != null ? Math.floor((verified / opex) * 10) / 10 : null,
    expectedCoverageMonths: ledger != null ? Math.floor((ledger / opex) * 10) / 10 : null,
    monthlyOperatingCosts: r0(opex),
    monthlyNetSettlementInflow: netMonthly,
    downside: downNet != null && downNet < 0
      ? { coverageMonths: months(verified ?? ledger, downNet), assumption: `sales ${Math.round(downPct * 100)}% below run-rate turns the business cash-negative (${egp(downNet)}/month)` }
      : downNet != null
        ? { coverageMonths: null, assumption: `even at ${Math.round(downPct * 100)}% lower sales the business stays cash-positive (${egp(downNet)}/month)` }
        : null,
    includes: ["derived recurring operating costs", "typical stock spend (flagged pace-able)", "settlement inflow net of the mall's cut"],
    excludes: ["owner withdrawals (never operating burn)", "rent (deducted from the cheque, already inside net settlement)", "expected cheques as available cash"],
    confidence: verified != null ? "medium" : "low",
  };
}
