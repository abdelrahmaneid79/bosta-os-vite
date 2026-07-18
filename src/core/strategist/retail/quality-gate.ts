/** Recommendation quality gate — PURE.
 *
 *  REBUILT around the objective. The old gate protected the engine's dignity:
 *  it suppressed anything uncertain, so on thin books it suppressed EVERYTHING
 *  and the owner opened the page to "nothing clears the evidence bar". That is
 *  not caution, it is abdication — a shop owner asking what to do tomorrow is
 *  owed an answer, and "your data is incomplete" has never sold a bag of nuts.
 *
 *  The gate now blocks exactly three things:
 *
 *    1. advice that is WRONG    — it contradicts a known hard fact
 *    2. advice that is HARMFUL  — it would damage the brand or the margin
 *    3. advice that is EMPTY    — no action, or no way to tell if it worked
 *
 *  Uncertainty is none of those. A thin-evidence recommendation is shown with
 *  its certainty labelled and its impact discounted by the objective function,
 *  which is how a real advisor behaves. */
import type { RetailRecommendation, RetailBusinessFacts } from "./contract";

export interface GateResult { ok: boolean; violations: string[] }

const TEST_TYPES = new Set([
  "mini_bag_test", "grab_and_go", "test_price_increase", "test_smaller_pack",
  "bundle_test", "threshold_offer", "cross_category_offer", "limited_time_test",
  "premium_pouch", "gift_format", "premium_display_block", "impulse_display",
  "increase_facings", "reduce_facings", "relocate", "improve_adjacency",
]);

export function gateRecommendation(r: RetailRecommendation, f: RetailBusinessFacts): GateResult {
  const v: string[] = [];

  // ── 1. EMPTY — nothing to do, or no way to know it worked ───────────────
  if (!r.proposedAction.trim()) v.push("no action to take");
  if (r.observedFacts.length === 0) v.push("not grounded in anything observed");
  if (r.successCriteria.length === 0 && r.type !== "collect_evidence") v.push("no way to tell if it worked");
  if (!r.reviewDate && !r.stopCondition && r.type !== "collect_evidence") v.push("no review date or stop condition");

  // ── 2. WRONG — contradicts a hard fact ──────────────────────────────────
  // Buying is the one move that can actually bounce: only block it when the
  // cash position is KNOWN and empty, never when it is merely unmeasured.
  if (r.type === "buy_now" && f.cashForPurchases != null && f.cashForPurchases <= 0) {
    v.push("recommends buying now while cash is confirmed unavailable");
  }
  // A claim of measured truth has to actually be measured. Mislabelling is a
  // correctness failure, not uncertainty — the owner has to be able to trust
  // the difference between "this happened" and "this is worth trying".
  if (TEST_TYPES.has(r.type) && r.truthLevel === "measured_conclusion") v.push("an untested move cannot be a measured conclusion");
  if (r.truthLevel === "experiment_hypothesis" && r.confidence === "high") v.push("an untested idea cannot be high confidence");
  if (r.truthLevel === "measured_conclusion" && f.isStale && r.confidence === "high") {
    v.push("high-confidence measured claim on stale books");
  }

  // ── 3. FABRICATED — a number with no arithmetic behind it ───────────────
  // The owner's standing rule: no invented data. An impact may be an
  // extrapolation, but it must always show the sum it came from.
  if (r.impact && r.impact.monthlyEgp !== 0 && r.impact.basis.trim().length < 12) {
    v.push("impact figure has no stated basis");
  }

  // ── 4. HARMFUL — earns money by damaging the brand or the margin ────────
  if (r.brandEffect === "risks" && (r.impact?.monthlyEgp ?? 0) <= 0) {
    v.push("risks the brand with no offsetting gain");
  }

  return { ok: v.length === 0, violations: v };
}

/** Deliberately empty of judgement about certainty.
 *
 *  The predecessor deleted every low-confidence recommendation that lacked an
 *  EGP figure. Combined with a coverage rule that forced low confidence
 *  whenever product-line coverage was under 60%, it deleted the entire list —
 *  which is precisely the behaviour this rebuild exists to end. Ranking by
 *  expected value in `objective.ts` already pushes weak ideas to the bottom;
 *  it does not need help from a suppressor. */
export function isLowValue(_r: RetailRecommendation): boolean {
  return false;
}
