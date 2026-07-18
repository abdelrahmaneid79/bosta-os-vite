/** ═══════════════════════════════════════════════════════════════════════
 *  THE OBJECTIVE — what BostaOS is actually for.
 *
 *  One goal, stated once, applied everywhere:
 *
 *      grow revenue  +  cut cost   without cheapening the brand
 *
 *  Everything in the strategist is ranked against that and nothing else.
 *  Data completeness is NOT part of the objective. Thin books make a number
 *  less certain — they are disclosed as such and they discount the score —
 *  but they never suppress the advice. A shop owner asking "what should I do
 *  tomorrow?" must always get an answer; being told the books are incomplete
 *  is not an answer.
 *
 *  This module is the single place the ranking lives, so the priority order
 *  on screen can always be explained in one sentence.
 *  PURE — no IO, no dates, no randomness. */
import type { BrandEffect, FindingConfidence, ImpactEstimate, RetailRecommendation } from "./contract";

/** How much of a claimed impact we actually bank when ranking.
 *  A directional effect is real but unsized locally, so it is heavily
 *  discounted rather than dropped — it still beats doing nothing. */
const KIND_WEIGHT: Record<ImpactEstimate["kind"], number> = {
  measured: 1,
  arithmetic: 0.75,
  directional: 0.35,
};

/** Certainty discounts the expected value; it never zeroes it. */
const CONFIDENCE_WEIGHT: Record<FindingConfidence, number> = {
  high: 1,
  medium: 0.8,
  low: 0.55,
};

/** Premium permission is an asset with real cash value: the whole reason a
 *  145 EGP walnut pack can exist beside a 45 EGP seed pack. A move that earns
 *  by cheapening the shelf is discounted; one that builds the brand carries a
 *  premium because its gain compounds into future pricing power. */
const BRAND_WEIGHT: Record<BrandEffect, number> = {
  builds: 1.15,
  neutral: 1,
  risks: 0.6,
};

/** Effort is a tiebreak, not a gate — a big win is worth real work. Applied
 *  mildly so that a large payoff never loses to a trivial tweak. */
const EFFORT_WEIGHT: Record<RetailRecommendation["effort"], number> = {
  low: 1,
  medium: 0.92,
  high: 0.82,
};

/** Moves that only pay during a live/imminent season are surfaced while the
 *  owner can still act on them — buying and packing need lead time. */
const SEASON_BOOST = 1.4;

export interface ScoredRecommendation extends RetailRecommendation {
  /** expected monthly EGP after certainty, brand and effort weighting */
  expectedMonthlyEgp: number;
  /** the ranking number — expectedMonthlyEgp with the seasonal-urgency boost */
  objectiveScore: number;
}

const CONF_RANK: Record<FindingConfidence, number> = { high: 3, medium: 2, low: 1 };
const TRUTH_RANK: Record<RetailRecommendation["truthLevel"], number> = {
  measured_conclusion: 3, strong_inference: 2, experiment_hypothesis: 1,
};

/** Expected monthly value of a move, in EGP, after every discount.
 *
 *  Not every good move can be priced — "put a brand header on the unbranded
 *  impulse tower" is obviously right and has no invoice attached. Rather than
 *  invent a number for it (the owner's standing rule forbids that), an unsized
 *  move gets a small deterministic rank built from how sure and how solid it
 *  is. That keeps the list stably ordered and always places real, traceable
 *  money above unpriced judgement. */
export function expectedValue(r: RetailRecommendation): number {
  const raw = r.impact?.monthlyEgp ?? r.financialImpactEgp ?? 0;
  if (raw === 0) {
    // unpriced: rank 1–12, always below anything with money attached
    const brand = r.brandEffect === "builds" ? 2 : r.brandEffect === "neutral" ? 1 : 0;
    return CONF_RANK[r.confidence] * TRUTH_RANK[r.truthLevel] + brand;
  }
  const weighted = Math.abs(raw)
    * KIND_WEIGHT[r.impact?.kind ?? "directional"]
    * CONFIDENCE_WEIGHT[r.confidence]
    * BRAND_WEIGHT[r.brandEffect]
    * EFFORT_WEIGHT[r.effort];
  // never let a priced move fall into the unpriced band
  return Math.max(13, Math.round(weighted));
}

/** Rank the owner's list. Highest expected monthly EGP first, seasonal plays
 *  lifted while they can still be acted on. */
export function scoreRecommendations(
  recs: RetailRecommendation[],
  opts: { seasonLive?: boolean } = {},
): ScoredRecommendation[] {
  return recs
    .map((r) => {
      const expectedMonthlyEgp = expectedValue(r);
      const seasonal = opts.seasonLive && r.domain === "seasonality" ? SEASON_BOOST : 1;
      return { ...r, expectedMonthlyEgp, objectiveScore: Math.round(expectedMonthlyEgp * seasonal) };
    })
    .sort((a, b) => b.objectiveScore - a.objectiveScore
      || b.expectedMonthlyEgp - a.expectedMonthlyEgp
      || a.title.localeCompare(b.title));
}

/** What the whole list is worth per month, split by lever, so the owner sees
 *  the size of the prize before reading a single recommendation. */
export interface ObjectiveSummary {
  revenueUpsideEgp: number;
  costSavingEgp: number;
  totalEgp: number;
  /** how much of the total is measured rather than extrapolated */
  measuredSharePct: number;
  count: number;
}

export function summariseObjective(recs: ScoredRecommendation[]): ObjectiveSummary {
  let revenue = 0, cost = 0, measured = 0;
  for (const r of recs) {
    const v = r.expectedMonthlyEgp;
    if (r.impact?.lever === "cost") cost += v; else revenue += v;
    if (r.impact?.kind === "measured") measured += v;
  }
  const total = revenue + cost;
  return {
    revenueUpsideEgp: Math.round(revenue),
    costSavingEgp: Math.round(cost),
    totalEgp: Math.round(total),
    measuredSharePct: total > 0 ? Math.round((measured / total) * 100) : 0,
    count: recs.length,
  };
}
