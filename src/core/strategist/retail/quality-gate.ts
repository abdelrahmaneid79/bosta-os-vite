/** Recommendation quality gate (Cycle 10, section 9) — PURE.
 *
 *  Before a recommendation is shown it must pass every check below. BostaOS
 *  prefers three excellent recommendations over twenty shallow ones, so a
 *  recommendation that references no facts, over-claims confidence, has no
 *  measurable success condition, or violates a cash/stock constraint is
 *  SUPPRESSED, not shown. */
import type { RetailRecommendation, RetailBusinessFacts, FindingConfidence } from "./contract";

export interface GateResult { ok: boolean; violations: string[] }

const CONF_RANK: Record<FindingConfidence, number> = { high: 2, medium: 1, low: 0 };

const TEST_TYPES = new Set([
  "mini_bag_test", "grab_and_go", "test_price_increase", "test_smaller_pack",
  "bundle_test", "threshold_offer", "cross_category_offer", "limited_time_test",
  "premium_pouch", "gift_format", "premium_display_block", "impulse_display",
  "increase_facings", "reduce_facings", "relocate", "improve_adjacency",
]);

export function gateRecommendation(r: RetailRecommendation, f: RetailBusinessFacts): GateResult {
  const v: string[] = [];

  // references actual facts + evidence
  if (r.observedFacts.length === 0) v.push("no observed facts");
  if (r.evidence.length === 0 && r.type !== "collect_evidence") v.push("no evidence references");

  // confidence must not exceed the evidence / ceiling
  if (CONF_RANK[r.confidence] > CONF_RANK[r.confidenceCeiling]) v.push("confidence exceeds ceiling");
  if (r.truthLevel === "experiment_hypothesis" && r.confidence === "high") v.push("a hypothesis cannot be high confidence");
  if (r.missingInformation.length > 0 && r.confidence === "high" && r.truthLevel !== "measured_conclusion") v.push("high confidence despite missing information");

  // classification correctness — a "test X" move must be a hypothesis
  if (TEST_TYPES.has(r.type) && r.truthLevel === "measured_conclusion") v.push("test-type action mislabelled as measured");

  // measurable success + a review trigger
  if (r.successCriteria.length === 0 && r.type !== "collect_evidence") v.push("no measurable success condition");
  if (!r.reviewDate && !r.stopCondition && r.type !== "collect_evidence") v.push("no review date or stop condition");

  // operational / constraint sanity — never say buy_now when cash is confirmed unavailable
  if (r.type === "buy_now" && f.cashForPurchases != null && f.cashForPurchases <= 0) v.push("recommends buying now while cash is unavailable");

  // stale data cannot support a current, confident operational move
  if (f.isStale && r.confidence === "high" && r.truthLevel === "measured_conclusion") v.push("high-confidence measured claim on stale books");

  return { ok: v.length === 0, violations: v };
}

/** A recommendation is low-value (and suppressed) when it survives the gate but
 *  carries no quantified impact, low confidence, and isn't even a testable
 *  hypothesis — i.e. it would just be noise. */
export function isLowValue(r: RetailRecommendation): boolean {
  return r.confidence === "low" && (r.financialImpactEgp == null || r.financialImpactEgp === 0) && r.truthLevel !== "experiment_hypothesis";
}
