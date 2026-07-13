/** Deterministic strategy-engine output types. The engine finds and ranks;
 *  the LLM only explains and prioritizes on top — never invents. */

export type InsightClass =
  | "fact" | "warning" | "opportunity" | "contradiction"
  | "data_quality" | "forecast" | "recommendation" | "decision_risk";

export type Urgency = "today" | "this_week" | "this_month" | "monitor";
export type FindingConfidence = "high" | "medium" | "low";

/** Every evidence row is copied VERBATIM from a snapshot metric — the chain
 *  from claim to audited number is unbroken by construction. */
export interface Evidence {
  label: string;
  value: string;      // formatted for display, e.g. "EGP 187,048" / "37.5%"
  source: string;     // Metric.source
  period: string;     // Metric.period
  screenLink: string; // Metric.screenLink
}

export interface ActionCandidate {
  title: string;
  action: string;          // the exact thing to do
  rationale: string;
  expectedImpact: string;  // quantified where the data allows, else honest range
  urgency: Urgency;
  confidence: FindingConfidence;
  screenLink: string;
  missingData: string[];
  caveats: string[];
  reversible: boolean;
}

export interface Finding {
  id: string;              // stable slug, e.g. "margin-drop"
  class: InsightClass;
  title: string;
  detail: string;          // one-paragraph deterministic explanation
  evidence: Evidence[];
  /** Estimated EGP at stake; null when honestly unquantifiable. */
  impactEgp: number | null;
  urgency: Urgency;
  /** This IS the confidence CEILING — no language provider may exceed it. */
  confidence: FindingConfidence;
  actionable: boolean;
  action: ActionCandidate | null;
  /** A weaker fallback move when the primary action isn't possible yet. */
  alternativeAction: string | null;
  missingData: string[];
  /** What (deterministically) drove this — product names, categories, days. */
  drivers: string[];
  /** Assumptions the finding rests on (e.g. an unconfirmed default target). */
  assumptions: string[];
  /** How the engine will consider this resolved (drives auto-resolve). */
  resolutionCriteria: string;
  /** Whether this finding qualifies for persistent insight tracking. */
  persistEligible: boolean;
  /** filled by rankFindings */
  score: number;
  rank: number;
}
