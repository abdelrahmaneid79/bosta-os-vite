/** Recommendation outcome tracking — PURE evaluation rules + the plan the
 *  store executes. The LLM never decides whether a recommendation worked:
 *  the deterministic engine's own findings are the judge.
 *
 *  Rule: an accepted action originating from finding X is evaluated against
 *  the CURRENT engine output —
 *    finding gone            → improved   (the engine's resolution criteria)
 *    impact ≥25% worse       → worsened
 *    still fires, similar    → no_meaningful_change (after the review window)
 *    coverage collapsed      → awaiting_data
 *    before review date      → in_progress
 *  Attribution caveat: "improved" means the ISSUE resolved, not proof the
 *  action caused it — the caveat is stored with every outcome. */
import type { Finding } from "../analysis/types";

export type OutcomeState =
  | "not_started" | "in_progress" | "awaiting_data" | "improved"
  | "no_meaningful_change" | "worsened" | "inconclusive" | "cancelled";

export interface ActionOutcomeRow {
  id: string;
  findingId: string | null;
  status: string;               // action status (accepted/in_progress/completed/dismissed)
  outcomeState: OutcomeState;
  baseline: { period: string; capturedAt: string; impactEgp: number | null; evidence: unknown[] } | null;
  reviewDate: string | null;    // ISO date
}

export interface OutcomeUpdate {
  actionId: string;
  outcomeState: OutcomeState;
  outcomeMetrics: {
    baselineImpactEgp: number | null;
    currentImpactEgp: number | null;
    findingStillFires: boolean;
    coverageOk: boolean;
    caveat: string;
  };
}

const CAVEAT = "before/after comparison on the engine's own finding — attribution to the action is plausible, not proven";

export function planOutcomeEvaluation(
  actions: ActionOutcomeRow[],
  currentFindings: Finding[],
  today: string,
  coverageOk: boolean,
): OutcomeUpdate[] {
  const byId = new Map(currentFindings.map((f) => [f.id, f]));
  const out: OutcomeUpdate[] = [];

  for (const a of actions) {
    if (!a.findingId || !a.baseline) continue;
    if (a.status === "dismissed") {
      if (a.outcomeState !== "cancelled") out.push({ actionId: a.id, outcomeState: "cancelled", outcomeMetrics: { baselineImpactEgp: a.baseline.impactEgp, currentImpactEgp: null, findingStillFires: false, coverageOk, caveat: "dismissed by owner" } });
      continue;
    }
    if (["improved", "worsened", "no_meaningful_change", "inconclusive", "cancelled"].includes(a.outcomeState)) continue; // already settled

    const current = byId.get(a.findingId) ?? null;
    const still = current != null;
    const base = a.baseline.impactEgp;
    const now = current?.impactEgp ?? null;
    const metrics = { baselineImpactEgp: base, currentImpactEgp: now, findingStillFires: still, coverageOk, caveat: CAVEAT };

    if (!coverageOk) {
      // can't judge on collapsed data — never fake a verdict
      if (a.outcomeState !== "awaiting_data") out.push({ actionId: a.id, outcomeState: "awaiting_data", outcomeMetrics: metrics });
      continue;
    }
    const reviewDue = a.reviewDate != null && a.reviewDate <= today;

    if (!still) {
      // the issue stopped firing — improvement per the engine's resolution rule
      out.push({ actionId: a.id, outcomeState: "improved", outcomeMetrics: metrics });
    } else if (base != null && now != null && now > base * 1.25) {
      out.push({ actionId: a.id, outcomeState: "worsened", outcomeMetrics: metrics });
    } else if (reviewDue) {
      out.push({ actionId: a.id, outcomeState: "no_meaningful_change", outcomeMetrics: metrics });
    } else if (a.outcomeState === "not_started" && a.status === "in_progress") {
      out.push({ actionId: a.id, outcomeState: "in_progress", outcomeMetrics: metrics });
    }
  }
  return out;
}
