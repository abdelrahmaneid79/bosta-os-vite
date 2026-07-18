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
import { expectedValue } from "./objective";
import { ev, pct } from "./helpers";

const CONF_RANK: Record<FindingConfidence, number> = { high: 2, medium: 1, low: 0 };
const RANK_CONF: FindingConfidence[] = ["low", "medium", "high"];
const minConf = (a: FindingConfidence, b: FindingConfidence): FindingConfidence => RANK_CONF[Math.min(CONF_RANK[a], CONF_RANK[b])];
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
  /** cap recommendations touching the same product — prevents one product
   *  crowding out the rest of the shop. Counted per product AND per domain, so
   *  a product can still contribute a pricing move and a placement move
   *  without them competing for the same slot. */
  maxPerProduct?: number;
}

export interface IngestResult {
  accepted: RetailRecommendation[];
  rejected: { id: string; source: RecommendationSource; violations: string[] }[];
}

/** Thin coverage / stale books cap how sure ANY candidate may be.
 *
 *  This LABELS certainty, it no longer decides whether the owner hears the
 *  advice. Unknown coverage now reads as "unknown" (medium) rather than being
 *  treated as the worst case: a physical move like lighting an unbranded
 *  display does not become less true because a product split is missing. */
export function coverageCeiling(f: RetailBusinessFacts): FindingConfidence {
  const cov = f.coveragePct;
  if (f.isStale) return "medium";
  if (cov == null) return "medium";
  if (cov >= 85) return "high";
  if (cov >= 50) return "medium";
  return "low";
}

/** Product-line coverage constrains claims ABOUT PRODUCT MIX. It has no
 *  bearing on how the stand is lit, signed, laid out or priced — those are
 *  observed directly, so they keep their own certainty. */
const COVERAGE_FREE_DOMAINS = new Set(["merchandising", "packaging", "seasonality", "promotions"]);

function classifyTruth(draft: RecommendationDraft, f: RetailBusinessFacts, source: RecommendationSource): TruthLevel {
  // a MODEL candidate may never be a measured conclusion — it cannot define truth
  if (source === "model_reasoning" && draft.truthLevel === "measured_conclusion") return "strong_inference";
  if (draft.truthLevel === "measured_conclusion" && (f.coveragePct ?? 0) < 60) return "strong_inference";
  return draft.truthLevel;
}

function finalize(c: Candidate, f: RetailBusinessFacts, opts: IngestOptions): RetailRecommendation {
  const truthLevel = classifyTruth(c.draft, f, c.source);
  let confidence = minConf(c.draft.confidence, c.confidenceCeiling);
  // book coverage only limits claims about the product mix
  if (!COVERAGE_FREE_DOMAINS.has(c.draft.domain)) confidence = minConf(confidence, coverageCeiling(f));
  if (truthLevel === "experiment_hypothesis") confidence = minConf(confidence, "medium");
  if (c.source === "model_reasoning") confidence = minConf(confidence, "medium"); // model never claims high

  const reviewDays = opts.reviewPeriodDays ?? c.draft.durationDays ?? 21;
  const reviewDate = new Date(Date.parse(opts.today) + reviewDays * 86_400_000).toISOString().slice(0, 10);
  const dedupeKey = `${c.draft.type}:${slug(c.draft.affectedProducts[0] ?? c.draft.domain)}`;

  const finalized: RetailRecommendation = {
    ...c.draft,
    id: `${c.playbookId}:${slug(c.draft.affectedProducts[0] ?? "portfolio")}`,
    dedupeKey, playbookId: c.playbookId, truthLevel, confidence, confidenceCeiling: c.confidenceCeiling,
    reviewDate, persistEligible: true, priorityScore: 0, source: c.source,
  };
  // THE ranking number: what this move is worth per month, discounted for
  // certainty, brand effect and effort. Data completeness plays no part.
  // A seasonal play is lifted while the owner can still act on it — buying and
  // packing need lead time, so a Ramadan move surfaced after Ramadan is worthless.
  const seasonal = c.draft.domain === "seasonality" && (f.season != null || f.nextSeason != null) ? 2 : 1;
  return { ...finalized, priorityScore: expectedValue(finalized) * seasonal };
}

/** The single funnel every candidate passes through. */
export function ingestCandidates(candidates: Candidate[], f: RetailBusinessFacts, opts: IngestOptions): IngestResult {
  const finalized = candidates.map((c) => finalize(c, f, opts));
  const open = new Set(opts.openDedupeKeys ?? []);
  const seen = new Set<string>();
  const perProduct = new Map<string, number>();
  // 3, not 2: one product can legitimately need a price fix AND a placement fix
  // AND a pack-size fix. Capping at 2 silently binned the third-best idea.
  const maxPerProduct = opts.maxPerProduct ?? 3;
  const accepted: RetailRecommendation[] = [];
  const rejected: IngestResult["rejected"] = [];
  // held back ONLY by the per-product cap — sound advice, deferred for balance
  const crowdedOut: RetailRecommendation[] = [];

  for (const r of finalized.sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id))) {
    const g = gateRecommendation(r, f);
    if (!g.ok) { rejected.push({ id: r.id, source: r.source, violations: g.violations }); continue; }
    if (isLowValue(r)) { rejected.push({ id: r.id, source: r.source, violations: ["low value"] }); continue; }
    if (open.has(r.dedupeKey) || seen.has(r.dedupeKey)) continue;
    const key = r.affectedProducts[0] ?? r.domain;
    if ((perProduct.get(key) ?? 0) >= maxPerProduct) { crowdedOut.push(r); continue; }
    seen.add(r.dedupeKey);
    perProduct.set(key, (perProduct.get(key) ?? 0) + 1);
    accepted.push(r);
  }

  // The default cap exists to stop ONE product monopolising the owner's
  // attention — not to shrink the list for its own sake. If slots remain after
  // every product has had its turn, give them to the best of what the cap held
  // back rather than handing back a shorter list than the owner could act on.
  // A cap the CALLER set explicitly is a real constraint and stays hard.
  const limit = opts.maxRecommendations ?? 8;
  const softCap = opts.maxPerProduct == null;
  for (const r of softCap ? crowdedOut : []) {
    if (accepted.length >= limit) {
      rejected.push({ id: r.id, source: r.source, violations: [`>${maxPerProduct} recommendations for ${r.affectedProducts[0] ?? r.domain}`] });
      continue;
    }
    if (seen.has(r.dedupeKey)) continue;
    seen.add(r.dedupeKey);
    accepted.push(r);
  }
  if (!softCap) {
    for (const r of crowdedOut) rejected.push({ id: r.id, source: r.source, violations: [`>${maxPerProduct} recommendations for ${r.affectedProducts[0] ?? r.domain}`] });
  }
  return { accepted: accepted.slice(0, limit), rejected };
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
    impact: null, brandEffect: "neutral", sharpenWith: null,
    missingInformation: [], confidence: "medium", evidence, screenLink: "/health",
    testDesign: raw.testDesign ?? null, baselineMetrics: [], successCriteria: raw.successCriteria ?? [],
    failureCriteria: raw.failureCriteria ?? [], stopCondition: raw.failureCriteria?.length ? `Stop if ${raw.failureCriteria[0]}` : "Stop if the guardrail metric worsens",
  };
  return { ok: true, candidate: { draft, playbookId: "model", source: "model_reasoning", confidenceCeiling: "medium" } };
}
