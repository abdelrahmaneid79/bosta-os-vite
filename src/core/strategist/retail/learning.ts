/** Deterministic learning from Bosta Bites experiments (Cycle 10, section 7).
 *
 *  NOT black-box ML — it prefers strategies that previously worked under similar
 *  conditions and cautions on strategies that were reversed. It only learns from
 *  a PRIOR TEST ON THE SAME PRODUCT (product overlap), so one result is never
 *  generalised across every category without evidence, and every adjustment
 *  cites the prior Bosta experiment. PURE. */
import type { RetailRecommendation } from "./contract";

export interface PriorExperiment {
  recType: string;
  domain: string;
  productNames: string[];
  decision: "keep" | "modify" | "reverse" | null;
  attribution: "strong" | "moderate" | "weak" | "inconclusive" | null;
  conclusion: string | null;
}

const overlaps = (a: string[], b: string[]) => a.some((x) => b.includes(x));

export function applyLearning(recs: RetailRecommendation[], priors: PriorExperiment[]): RetailRecommendation[] {
  if (!priors.length) return recs;
  return recs.map((r) => {
    // same move, same product — the only basis strong enough to learn from
    const matches = priors.filter((p) => p.recType === r.type && overlaps(p.productNames, r.affectedProducts));
    if (!matches.length) return r;
    const kept = matches.find((p) => p.decision === "keep" && (p.attribution === "strong" || p.attribution === "moderate"));
    const reversed = matches.find((p) => p.decision === "reverse");
    if (kept) {
      return {
        ...r,
        source: "bosta_experiment" as const,   // provenance: a prior Bosta test now reinforces this
        reasoning: [...r.reasoning, `A prior Bosta Bites test of this exact move was kept (attribution ${kept.attribution}${kept.conclusion ? `: ${kept.conclusion}` : ""}).`],
        assumptions: r.assumptions,
        priorityScore: r.priorityScore + 2,
      };
    }
    if (reversed) {
      return {
        ...r,
        contraindications: [...r.contraindications, `A prior Bosta Bites test of this move was reversed${reversed.conclusion ? ` (${reversed.conclusion})` : ""} — validate carefully before repeating.`],
        priorityScore: Math.max(0, r.priorityScore - 1),
      };
    }
    return r;
  }).sort((a, b) => b.priorityScore - a.priorityScore);
}

/** Map persisted experiment rows into the learning input. */
export function priorsFromExperiments(rows: { recType: string; domain: string; productIds: string[]; decision: PriorExperiment["decision"]; attributionConfidence: PriorExperiment["attribution"]; conclusion: string | null; status: string }[], nameById: Map<string, string>): PriorExperiment[] {
  return rows
    .filter((r) => r.status === "complete")
    .map((r) => ({
      recType: r.recType, domain: r.domain,
      productNames: r.productIds.map((id) => nameById.get(id) ?? id),
      decision: r.decision, attribution: r.attributionConfidence, conclusion: r.conclusion,
    }));
}
