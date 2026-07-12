/** Deterministic decision context — pure scenario numbers computed BEFORE the
 *  LLM sees a proposed decision, so projections are grounded, not improvised.
 *  Anything unknowable stays null with a reason; the model is instructed to
 *  use these figures verbatim and to refuse fake precision beyond them. */
import type { StrategistSnapshot } from "../contract";

export interface DecisionContext {
  /** cash available above the owner's reserve floor (null when cash untracked) */
  cashHeadroomAboveFloor: number | null;
  cashHeadroomNote: string;
  /** 50%-of-net-profit guideline (the documented withdrawal rule) */
  withdrawalGuidelineMax: number | null;
  monthlyNetProfit: number | null;
  monthlyNetProfitNote: string;
  /** money already earned, waiting in the settlement pipe (estimated net) */
  openTabEstimatedNet: number | null;
  avgDailyRevenue30: number | null;
  grossMarginPct: number | null;
  grossMarginCoverage: number | null;
  reserveFloor: number;
  /** products below the owner's margin floor — repricing candidates */
  belowMarginFloor: { name: string; marginPct: number; revenue: number }[];
  /** what a 1-point margin change is worth per period on covered revenue */
  marginPointValue: number | null;
  caveats: string[];
}

export function computeDecisionContext(s: StrategistSnapshot): DecisionContext {
  const caveats: string[] = [];
  const floor = s.context.cashReserveFloor.value ?? 25_000;

  const cashKnown = s.cash.hasLiveData && s.cash.expectedBalance.value != null;
  if (!cashKnown) caveats.push("cash is not tracked yet — cash headroom is unknowable until the first drawer count");
  const netProfit = s.profit.netProfit.value;
  if (netProfit == null) caveats.push("net profit is withheld for the period (incomplete cost coverage) — profit-based rules use null");
  if ((s.profit.coveredRevenue.completeness ?? 0) < 95) caveats.push(`margins are measured on ${s.profit.coveredRevenue.completeness ?? 0}% of revenue only`);

  const marginFloor = s.context.grossMarginFloorPct.value ?? 25;
  const below = [
    ...(s.products.topRevenue.value ?? []),
    ...(s.products.highVolumeLowMargin.value ?? []),
  ]
    .filter((p, i, arr) => arr.findIndex((q) => q.name === p.name) === i)
    .filter((p) => p.marginPct != null && p.marginPct < marginFloor)
    .map((p) => ({ name: p.name, marginPct: p.marginPct as number, revenue: p.revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const covered = s.profit.coveredRevenue.value;

  return {
    cashHeadroomAboveFloor: cashKnown ? Math.round((s.cash.expectedBalance.value as number) - floor) : null,
    cashHeadroomNote: cashKnown ? `expected balance minus the ${floor.toLocaleString()} EGP reserve floor` : "unknown — no cash tracking yet",
    withdrawalGuidelineMax: netProfit != null ? Math.round(netProfit * 0.5) : null,
    monthlyNetProfit: netProfit,
    monthlyNetProfitNote: netProfit != null ? "period net profit from the audited P&L" : "withheld — cost coverage incomplete",
    openTabEstimatedNet: s.cheques.openTabEstimatedNet.value,
    avgDailyRevenue30: s.revenue.rolling30Avg.value,
    grossMarginPct: s.profit.grossMarginPct.value,
    grossMarginCoverage: s.profit.coveredRevenue.completeness ?? null,
    reserveFloor: floor,
    belowMarginFloor: below,
    marginPointValue: covered != null ? Math.round(covered / 100) : null,
    caveats,
  };
}
