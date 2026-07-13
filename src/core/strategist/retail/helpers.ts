/** Shared builders for retail playbooks — keeps each playbook terse and its
 *  recommendation shape consistent. PURE. */
import type { Evidence, ProductFact, RecommendationDraft } from "./contract";

export const egp = (n: number) => `EGP ${Math.round(n).toLocaleString()}`;
export const pct = (n: number | null) => (n == null ? "unknown" : `${Math.round(n * 10) / 10}%`);

export function ev(label: string, value: string, source: string, period: string, screenLink = "/health"): Evidence {
  return { label, value, source, period, screenLink };
}

type DraftInput = {
  title: string;
  domain: RecommendationDraft["domain"];
  type: RecommendationDraft["type"];
  product?: ProductFact;
  affectedProducts?: string[];
  affectedProductIds?: string[];
  affectedCategory?: string | null;
  affectedLocation?: string | null;
  observedFacts: string[];
  principles: string[];
  reasoning: string[];
  truthLevel: RecommendationDraft["truthLevel"];
  proposedAction: string;
  implementationSteps?: string[];
  timing: string;
  durationDays?: number | null;
  effort?: RecommendationDraft["effort"];
  mechanism: string;
  expectedBenefitType: string;
  financialImpactEgp?: number | null;
  risks?: string[];
  contraindications?: string[];
  assumptions?: string[];
  missingInformation?: string[];
  confidence: RecommendationDraft["confidence"];
  evidence?: Evidence[];
  screenLink?: string;
  testDesign?: string | null;
  baselineMetrics?: string[];
  successCriteria?: string[];
  failureCriteria?: string[];
  stopCondition?: string | null;
};

/** Build a fully-formed draft with sensible defaults. */
export function draft(d: DraftInput): RecommendationDraft {
  return {
    title: d.title,
    domain: d.domain,
    type: d.type,
    affectedProducts: d.affectedProducts ?? (d.product ? [d.product.name] : []),
    affectedProductIds: d.affectedProductIds ?? (d.product?.id ? [d.product.id] : []),
    affectedCategory: d.affectedCategory ?? d.product?.category ?? null,
    affectedLocation: d.affectedLocation ?? null,
    observedFacts: d.observedFacts,
    principles: d.principles,
    reasoning: d.reasoning,
    truthLevel: d.truthLevel,
    proposedAction: d.proposedAction,
    implementationSteps: d.implementationSteps ?? [],
    timing: d.timing,
    durationDays: d.durationDays ?? null,
    effort: d.effort ?? "low",
    mechanism: d.mechanism,
    expectedBenefitType: d.expectedBenefitType,
    financialImpactEgp: d.financialImpactEgp ?? null,
    risks: d.risks ?? [],
    contraindications: d.contraindications ?? [],
    assumptions: d.assumptions ?? [],
    missingInformation: d.missingInformation ?? [],
    confidence: d.confidence,
    evidence: d.evidence ?? [],
    screenLink: d.screenLink ?? "/health",
    testDesign: d.testDesign ?? null,
    baselineMetrics: d.baselineMetrics ?? [],
    successCriteria: d.successCriteria ?? [],
    failureCriteria: d.failureCriteria ?? [],
    stopCondition: d.stopCondition ?? null,
  };
}
