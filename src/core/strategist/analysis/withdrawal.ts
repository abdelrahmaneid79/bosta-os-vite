/** Withdrawal assessment — PURE deterministic verdict on "can I take out X?".
 *  Keeps profit, cash, settlement money and the reserve floor strictly apart:
 *  a profitable business can still be unable to afford a draw. */
import type { StrategistSnapshot } from "../contract";
import type { DecisionContext } from "./decision";

export type WithdrawalVerdict = "safe" | "tight" | "unsafe" | "unknowable";

export interface WithdrawalAssessment {
  amount: number;
  verdict: WithdrawalVerdict;
  /** each line is a separated money concept, owner-language */
  cashPosition: string;      // current expected cash (or unknown)
  reserveFloor: string;
  headroom: string;          // cash above the floor (or unknown)
  profitContext: string;     // net profit + the 50% guideline
  settlementContext: string; // money still parked at the mall
  dataFreshness: string;
  recommendedMax: number | null;
  reasonsToWait: string[];
  confidence: "high" | "medium" | "low";
}

const egp = (n: number) => `EGP ${Math.round(n).toLocaleString("en-US")}`;

export function assessWithdrawal(s: StrategistSnapshot, d: DecisionContext, amount: number): WithdrawalAssessment {
  const reasons: string[] = [];
  const floor = d.reserveFloor;
  const headroom = d.cashHeadroomAboveFloor;
  const guideline = d.withdrawalGuidelineMax;

  const cashKnown = headroom != null;
  const profitKnown = guideline != null;

  let verdict: WithdrawalVerdict;
  if (!cashKnown && !profitKnown) verdict = "unknowable";
  else if (cashKnown && amount > (headroom as number)) verdict = "unsafe";
  else if (profitKnown && amount > (guideline as number)) verdict = cashKnown ? "tight" : "unknowable";
  else if (!cashKnown) verdict = "unknowable";
  else verdict = amount > (headroom as number) * 0.7 ? "tight" : "safe";

  if (!cashKnown) reasons.push("Cash is not tracked yet — do the first drawer count before trusting any cash figure.");
  if (cashKnown && amount > (headroom as number)) reasons.push(`Taking ${egp(amount)} would push cash ${egp(amount - (headroom as number))} below your ${egp(floor)} reserve floor.`);
  if (profitKnown && amount > (guideline as number)) reasons.push(`It exceeds the 50%-of-net-profit guideline (${egp(guideline as number)} this period).`);
  if (!profitKnown) reasons.push("Net profit is withheld this period (incomplete cost coverage) — the profit-based guideline can't be computed.");
  if ((s.cheques.openTabEstimatedNet.value ?? 0) > 0) reasons.push(`~${egp(s.cheques.openTabEstimatedNet.value as number)} is due from the mall — waiting for the cheque widens your headroom.`);
  if (s.meta.isStale && s.meta.staleDays != null) reasons.push(`Books are ${s.meta.staleDays} days behind — the real position may differ.`);

  const recommendedMax = cashKnown && profitKnown
    ? Math.max(0, Math.min(headroom as number, guideline as number))
    : cashKnown ? Math.max(0, Math.round((headroom as number) * 0.5)) : null;

  const confidence: WithdrawalAssessment["confidence"] =
    verdict === "unknowable" ? "low"
    : cashKnown && profitKnown && !s.meta.isStale ? "high"
    : "medium";

  return {
    amount,
    verdict,
    cashPosition: s.cash.expectedBalance.value != null && s.cash.hasLiveData
      ? `${egp(s.cash.expectedBalance.value)} expected on hand (${s.cash.expectedBalance.note ?? "ledger-derived"})`
      : "Unknown — no cash tracking yet. The ledger-only estimate ignores uncounted drawer cash.",
    reserveFloor: `${egp(floor)}${s.context.cashReserveFloor.basis === "estimated" ? " (your unconfirmed default — edit it in Tune)" : ""}`,
    headroom: headroom != null ? `${egp(headroom)} available above the floor` : "Unknowable without cash tracking.",
    profitContext: guideline != null
      ? `Net profit ${egp(d.monthlyNetProfit as number)} this period → 50% guideline = ${egp(guideline)}. Profit is timing, not cash — both limits must hold.`
      : `Net profit is withheld (${d.monthlyNetProfitNote}).`,
    settlementContext: s.cheques.openTabEstimatedNet.value != null
      ? `~${egp(s.cheques.openTabEstimatedNet.value)} net is still parked at the mall (gross ${egp(s.cheques.openTabGross.value ?? 0)}) — it is NOT in your drawer yet.`
      : "Open settlement value unknown.",
    dataFreshness: s.meta.lastDataDate
      ? `Books current to ${s.meta.lastDataDate}${s.meta.isStale ? ` — ${s.meta.staleDays} days behind` : ""}.`
      : "No sales data.",
    recommendedMax,
    reasonsToWait: reasons,
    confidence,
  };
}
