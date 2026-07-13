/** Candidate intake — the shared validation pipeline (Cycle 10, boundary
 *  correction). EVERY proposed recommendation — whether authored by a
 *  deterministic playbook, a prior Bosta experiment, or an external model —
 *  enters here as a CANDIDATE and passes the SAME deterministic checks before it
 *  can reach the owner: confidence capped by ceiling AND coverage/freshness,
 *  truth-level assigned (a model candidate can never be "measured"), the quality
 *  gate, low-value suppression, dedupe and ranking.
 *
 *  The model may AUTHOR creative ideas; it may not DEFINE truth. Its numbers are
 *  never trusted — evidence is (re)attached from the deterministic facts for the
 *  products it references, and a candidate that names an unknown product, omits
 *  a measurable test, or violates a constraint is REJECTED (or flagged for
 *  repair), never shown. */
import type {
  RetailBusinessFacts, RetailRecommendation, RecommendationDraft, FindingConfidence, TruthLevel, RecommendationSource,
} from "./contract";
import { gateRecommendation, isLowValue } from "./quality-gate";
import { ev, pct } from "./helpers";

const CONF_RANK: Record<FindingConfidence, number> = { high: 2, medium: 1, low: 0 };
const RANK_CONF: FindingConfidence[] = ["low", "medium", "high"];
const minConf = (a: FindingConfidence, b: FindingConfidence): FindingConfidence => RANK_CONF[Math.min(CONF_RANK[a], CONF_RANK[b])];
const TRUTH_RANK: Record<TruthLevel, number> = { measured_conclusion: 3, strong_inference: 2, experiment_hypothesis: 1 };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

export interface Candidate {
  draft: RecommendationDraft;
  playbookId: string;
  source: RecommendationSource;
  confidenceCeiling: FindingConfidence;
}

export interface IngestOptions {
  today: string;
  reviewPeriodDays?: number;
  openDedupeKeys?: string[];
  maxRecommendations?: number;
  /** cap recommendations touching the same product — prevents flooding one
   *  product with overlapping advice (prefer few excellent over many shallow) */
  maxPerProduct?: number;
}

export interface IngestResult {
  accepted: RetailRecommendation[];
  rejected: { id: string; source: RecommendationSource; violations: string[] }[];
}

/** Thin coverage / stale books cap how sure ANY candidate may be. */
export function coverageCeiling(f: RetailBusinessFacts): FindingConfidence {
  const cov = f.coveragePct ?? 0;
  if (f.isStale) return "medium";
  if (cov >= 85) return "high";
  if (cov >= 60) return "medium";
  return "low";
}

function classifyTruth(draft: RecommendationDraft, f: RetailBusinessFacts, source: RecommendationSource): TruthLevel {
  // a MODEL candidate may never be a measured conclusion — it cannot define truth
  if (source === "model_reasoning" && draft.truthLevel === "measured_conclusion") return "strong_inference";
  if (draft.truthLevel === "measured_conclusion" && (f.coveragePct ?? 0) < 60) return "strong_inference";
  return draft.truthLevel;
}

function finalize(c: Candidate, f: RetailBusinessFacts, opts: IngestOptions): RetailRecommendation {
  const truthLevel = classifyTruth(c.draft, f, c.source);
  let confidence = minConf(minConf(c.draft.confidence, c.confidenceCeiling), coverageCeiling(f));
  if (truthLevel === "experiment_hypothesis") confidence = minConf(confidence, "medium");
  if (c.source === "model_reasoning") confidence = minConf(confidence, "medium"); // model never claims high

  const reviewDays = opts.reviewPeriodDays ?? c.draft.durationDays ?? 21;
  const reviewDate = new Date(Date.parse(opts.today) + reviewDays * 86_400_000).toISOString().slice(0, 10);
  const dedupeKey = `${c.draft.type}:${slug(c.draft.affectedProducts[0] ?? c.draft.domain)}`;
  const impactBand = c.draft.financialImpactEgp != null ? Math.min(3, Math.floor(c.draft.financialImpactEgp / 5000)) : 0;
  // a seasonal play is most relevant while its season is live — surface it above generic tweaks
  const seasonalBoost = c.draft.domain === "seasonality" && f.season != null ? 2 : 0;
  const priorityScore = CONF_RANK[confidence] * 3 + TRUTH_RANK[truthLevel] + impactBand + seasonalBoost + (c.draft.missingInformation.length ? 0 : 1);

  return {
    ...c.draft,
    id: `${c.playbookId}:${slug(c.draft.affectedProducts[0] ?? "portfolio")}`,
    dedupeKey, playbookId: c.playbookId, truthLevel, confidence, confidenceCeiling: c.confidenceCeiling,
    reviewDate, persistEligible: true, priorityScore, source: c.source,
  };
}

/** The single funnel every candidate passes through. */
export function ingestCandidates(candidates: Candidate[], f: RetailBusinessFacts, opts: IngestOptions): IngestResult {
  const finalized = candidates.map((c) => finalize(c, f, opts));
  const open = new Set(opts.openDedupeKeys ?? []);
  const seen = new Set<string>();
  const perProduct = new Map<string, number>();
  const maxPerProduct = opts.maxPerProduct ?? 2;
  const accepted: RetailRecommendation[] = [];
  const rejected: IngestResult["rejected"] = [];
  for (const r of finalized.sort((a, b) => b.priorityScore - a.priorityScore)) {
    const g = gateRecommendation(r, f);
    if (!g.ok) { rejected.push({ id: r.id, source: r.source, violations: g.violations }); continue; }
    if (isLowValue(r)) { rejected.push({ id: r.id, source: r.source, violations: ["low value"] }); continue; }
    if (open.has(r.dedupeKey) || seen.has(r.dedupeKey)) continue;
    const key = r.affectedProducts[0] ?? r.domain;
    if ((perProduct.get(key) ?? 0) >= maxPerProduct) { rejected.push({ id: r.id, source: r.source, violations: [`>${maxPerProduct} recommendations for ${key}`] }); continue; }
    seen.add(r.dedupeKey);
    perProduct.set(key, (perProduct.get(key) ?? 0) + 1);
    accepted.push(r);
  }
  return { accepted: accepted.slice(0, opts.maxRecommendations ?? 8), rejected };
}

/* ── model-authored candidates ─────────────────────────────────────────── */

/** What an external model is allowed to emit — an IDEA, never a fact. */
export interface ModelCandidateInput {
  title: string;
  domain: RecommendationDraft["domain"];
  type: RecommendationDraft["type"];
  affectedProducts: string[];
  proposedAction: string;
  reasoning: string[];
  mechanism?: string;
  expectedBenefitType?: string;
  implementationSteps?: string[];
  testDesign?: string;
  successCriteria?: string[];
  failureCriteria?: string[];
  risks?: string[];
  timing?: string;
  durationDays?: number;
}

/** Deterministic validation + experiment-design layer for a model idea. On
 *  success it returns a grounded Candidate (evidence RE-ATTACHED from real
 *  facts, truth forced to a hypothesis, confidence capped). On failure it lists
 *  what must be repaired — the idea is never shown as-is. */
export function validateModelCandidate(raw: ModelCandidateInput, f: RetailBusinessFacts):
  { ok: true; candidate: Candidate } | { ok: false; violations: string[] } {
  const violations: string[] = [];
  const known = new Map(f.products.map((p) => [p.name, p]));

  if (!raw.affectedProducts.length) violations.push("names no product");
  const unknown = raw.affectedProducts.filter((n) => !known.has(n));
  if (unknown.length) violations.push(`references unknown product(s): ${unknown.join(", ")}`);
  if (!raw.reasoning.length) violations.push("no reasoning");
  if (!raw.testDesign) violations.push("no test design (a model idea must be testable)");
  if (!raw.successCriteria?.length) violations.push("no measurable success criteria");
  if (violations.length) return { ok: false, violations };

  // evidence is taken from the DETERMINISTIC facts, not the model's words
  const p = known.get(raw.affectedProducts[0])!;
  const evidence = [
    ev("Revenue share", pct(p.revenueSharePct), "read/products", f.period, "/sales"),
    p.marginPct != null ? ev("Margin", pct(p.marginPct), "read/profit", f.period, "/health") : ev("Units", `${p.units}`, "read/products", f.period, "/sales"),
  ];
  const observedFacts = [
    `${p.name}: ${pct(p.revenueSharePct)} of revenue${p.marginPct != null ? `, ${pct(p.marginPct)} margin` : ""}${p.profitSharePct != null ? `, ${pct(p.profitSharePct)} of gross profit` : ""}.`,
  ];

  const draft: RecommendationDraft = {
    title: raw.title, domain: raw.domain, type: raw.type,
    affectedProducts: raw.affectedProducts, affectedProductIds: [], affectedCategory: p.category, affectedLocation: null,
    observedFacts, principles: ["Model-authored hypothesis, grounded in your data and validated deterministically."],
    reasoning: raw.reasoning, truthLevel: "experiment_hypothesis", proposedAction: raw.proposedAction,
    implementationSteps: raw.implementationSteps ?? [], timing: raw.timing ?? "next reset", durationDays: raw.durationDays ?? null,
    effort: "medium", mechanism: raw.mechanism ?? "As reasoned above.", expectedBenefitType: raw.expectedBenefitType ?? "to be measured",
    financialImpactEgp: null, risks: raw.risks ?? [], contraindications: [], assumptions: ["Authored by model reasoning — treat as a hypothesis until tested."],
    missingInformation: [], confidence: "medium", evidence, screenLink: "/health",
    testDesign: raw.testDesign ?? null, baselineMetrics: [], successCriteria: raw.successCriteria ?? [],
    failureCriteria: raw.failureCriteria ?? [], stopCondition: raw.failureCriteria?.length ? `Stop if ${raw.failureCriteria[0]}` : "Stop if the guardrail metric worsens",
  };
  return { ok: true, candidate: { draft, playbookId: "model", source: "model_reasoning", confidenceCeiling: "medium" } };
}
