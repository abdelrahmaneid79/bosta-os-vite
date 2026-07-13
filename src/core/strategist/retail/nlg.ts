/** Deterministic executive language for retail recommendations (Cycle 10,
 *  section 8) — PRIMARY, zero API. Turns a RetailRecommendation into concise,
 *  specific commercial advice in the fixed flow: conclusion → evidence →
 *  interpretation → action → method → success → risk → confidence. NEVER
 *  invents; composes only from the recommendation's structured fields. Banned
 *  filler ("consider monitoring", "leverage", "maintain momentum", …) never
 *  appears because no such string exists here. */
import type { RetailRecommendation, TruthLevel } from "./contract";

const TRUTH_LABEL: Record<TruthLevel, string> = {
  measured_conclusion: "Measured conclusion",
  strong_inference: "Strong inference",
  experiment_hypothesis: "Experiment hypothesis",
};
const CONF_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;
const SOURCE_LABEL: Record<RetailRecommendation["source"], string> = {
  deterministic_knowledge: "Deterministic retail knowledge",
  bosta_experiment: "Prior Bosta Bites experiment",
  model_reasoning: "Model reasoning (validated)",
};

const s = (t: string) => { const x = t.trim(); return x ? (/[.!?]$/.test(x) ? x : `${x}.`) : ""; };

export interface RenderedRecommendation {
  headline: string;
  paragraphs: string[];
  classification: string;
  confidence: string;
  sourceLabel: string;
  evidenceLine: string;
  missingLine: string | null;
  text: string;
}

export function renderRecommendation(r: RetailRecommendation): RenderedRecommendation {
  const method = r.testDesign
    ? `Method: ${s(r.testDesign)}`
    : r.implementationSteps.length
      ? `How: ${r.implementationSteps.map((x) => x.replace(/\.$/, "")).join("; ")}.`
      : "";
  const success = r.successCriteria.length ? `Keep it only if ${lower(r.successCriteria.join("; "))}` : "";
  const risk = r.risks.length ? `Watch: ${r.risks.join("; ")}` : (r.contraindications.length ? `Caution: ${r.contraindications.join("; ")}` : "");

  const paragraphs = [
    // 1 conclusion + 2 evidence
    [s(r.proposedAction), ...r.observedFacts.map(s)].filter(Boolean).join(" "),
    // 3 interpretation + 4/5 method + success
    [s(r.mechanism), method, s(success)].filter(Boolean).join(" "),
    // 6 risk
    s(risk),
  ].filter(Boolean);

  const classification = TRUTH_LABEL[r.truthLevel];
  const confidence = CONF_LABEL[r.confidence];
  const sourceLabel = SOURCE_LABEL[r.source];
  const evidenceLine = r.evidence.length
    ? `Evidence: ${r.evidence.map((e) => `${e.label} ${e.value}`).join(", ")}`
    : (r.observedFacts.length ? `Evidence: ${r.observedFacts.length} observed fact(s)` : "Evidence: —");
  const missingLine = r.missingInformation.length ? `Missing: ${r.missingInformation.join(", ")}` : null;

  const text = [
    ...paragraphs,
    `Classification: ${classification}. Confidence: ${confidence}. Source: ${sourceLabel}.`,
    evidenceLine + (missingLine ? `\n${missingLine}` : ""),
  ].join("\n\n");

  return { headline: r.title, paragraphs, classification, confidence, sourceLabel, evidenceLine, missingLine, text };
}

function lower(str: string): string {
  if (!str) return str;
  const a = str[0], b = str[1] ?? "";
  if (a === a.toUpperCase() && b === b.toUpperCase()) return str;
  return a.toLowerCase() + str.slice(1);
}

/** Phrases BostaOS must never emit — used by tests to prove there's no filler. */
export const BANNED_FILLER = [
  "consider monitoring", "leverage opportunities", "maintain momentum",
  "continue reviewing", "sales are doing well", "this may indicate", "keep an eye on",
];
