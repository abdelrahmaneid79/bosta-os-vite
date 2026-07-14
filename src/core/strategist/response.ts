/** Structured strategist response — mirrors the edge function's forced tool
 *  schema exactly. Free text never arrives as the primary output. */
import { toPlainEnglish } from "./plain-english";

export type PriorityType = "risk" | "opportunity" | "contradiction" | "data" | "action";
export type ResponseUrgency = "today" | "this_week" | "this_month" | "monitor";
export type ResponseConfidence = "high" | "medium" | "low";

export interface ResponseEvidence {
  label: string;
  value: string;
  source: string;
  period: string;
  screenLink: string;
}

export interface ResponsePriority {
  rank: number;
  type: PriorityType;
  title: string;
  explanation: string;
  evidence: ResponseEvidence[];
  recommendedAction: string;
  expectedImpact: string;
  urgency: ResponseUrgency;
  confidence: ResponseConfidence;
  missingData: string[];
}

export interface StrategistResponse {
  mode: string;
  headline: string;
  conclusion: string;
  priorities: ResponsePriority[];
  contradictions: string[];
  dataLimitations: string[];
  suggestedQuestions: string[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | null;
  latencyMs?: number;
}

/** Narrow an unknown payload to a StrategistResponse; throws on shape violations. */
export function parseStrategistResponse(x: unknown): StrategistResponse {
  const o = x as Partial<StrategistResponse>;
  if (!o || typeof o.headline !== "string" || typeof o.conclusion !== "string" || !Array.isArray(o.priorities)) {
    throw new Error("Malformed strategist response");
  }
  // Plain-English is enforced HERE, not just via the system prompt — this is
  // the one place every LLM-authored word passes through before reaching the
  // owner, so the Executive Communication Standard holds even if the model
  // drifts. Evidence label/value are left untouched: they're literal metric
  // names/audited figures, not prose.
  return {
    mode: String(o.mode ?? "question"),
    headline: toPlainEnglish(o.headline),
    conclusion: toPlainEnglish(o.conclusion),
    priorities: o.priorities.map((p, idx) => ({
      rank: typeof p.rank === "number" ? p.rank : idx + 1,
      type: (["risk", "opportunity", "contradiction", "data", "action"] as const).includes(p.type as PriorityType) ? (p.type as PriorityType) : "action",
      title: toPlainEnglish(String(p.title ?? "")),
      explanation: toPlainEnglish(String(p.explanation ?? "")),
      evidence: Array.isArray(p.evidence) ? p.evidence.map((e) => ({
        label: String(e.label ?? ""), value: String(e.value ?? ""), source: String(e.source ?? ""),
        period: String(e.period ?? ""), screenLink: String(e.screenLink ?? "/health"),
      })) : [],
      recommendedAction: toPlainEnglish(String(p.recommendedAction ?? "")),
      expectedImpact: toPlainEnglish(String(p.expectedImpact ?? "")),
      urgency: (["today", "this_week", "this_month", "monitor"] as const).includes(p.urgency as ResponseUrgency) ? (p.urgency as ResponseUrgency) : "monitor",
      confidence: (["high", "medium", "low"] as const).includes(p.confidence as ResponseConfidence) ? (p.confidence as ResponseConfidence) : "low",
      missingData: Array.isArray(p.missingData) ? p.missingData.map(String) : [],
    })),
    contradictions: Array.isArray(o.contradictions) ? o.contradictions.map((x) => toPlainEnglish(String(x))) : [],
    dataLimitations: Array.isArray(o.dataLimitations) ? o.dataLimitations.map((x) => toPlainEnglish(String(x))) : [],
    suggestedQuestions: Array.isArray(o.suggestedQuestions) ? o.suggestedQuestions.map(String) : [],
    model: o.model,
    usage: o.usage ?? null,
    latencyMs: o.latencyMs,
  };
}
