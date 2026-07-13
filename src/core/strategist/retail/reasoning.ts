/** RETAIL REASONING ENGINE (Cycle 10) — PURE, zero API.
 *
 *  Combines RetailBusinessFacts + the Retail Knowledge Library into ranked,
 *  gated RetailRecommendations. It NEVER jumps from a weak signal to a confident
 *  recommendation: confidence is capped by the playbook ceiling AND by data
 *  coverage/freshness, and every "test X" move is forced to the
 *  experiment_hypothesis truth level. Duplicates of open actions/experiments are
 *  dropped, low-value noise is suppressed, and only the best survive. */
import type {
  RetailBusinessFacts, RetailRecommendation, RecommendationDraft, KnowledgePlaybook, FindingConfidence, TruthLevel,
} from "./contract";
import { KNOWLEDGE_LIBRARY } from "./knowledge";
import { gateRecommendation, isLowValue } from "./quality-gate";

const CONF_RANK: Record<FindingConfidence, number> = { high: 2, medium: 1, low: 0 };
const RANK_CONF: FindingConfidence[] = ["low", "medium", "high"];
const minConf = (a: FindingConfidence, b: FindingConfidence): FindingConfidence => RANK_CONF[Math.min(CONF_RANK[a], CONF_RANK[b])];
const TRUTH_RANK: Record<TruthLevel, number> = { measured_conclusion: 3, strong_inference: 2, experiment_hypothesis: 1 };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

export interface ReasoningOptions {
  today: string;
  reviewPeriodDays?: number;         // default: playbook.minTestDurationDays
  openDedupeKeys?: string[];         // recs already accepted as actions/experiments
  maxRecommendations?: number;       // default 8 — prefer few excellent
}

/** Data-coverage confidence ceiling: thin coverage or stale books cap how sure
 *  ANY recommendation may be. */
function coverageCeiling(f: RetailBusinessFacts): FindingConfidence {
  const cov = f.coveragePct ?? 0;
  if (f.isStale) return "medium";
  if (cov >= 85) return "high";
  if (cov >= 60) return "medium";
  return "low";
}

/** A "test X" recommendation is always a hypothesis; a measured claim on thin
 *  coverage degrades to a strong inference. */
function classifyTruth(draft: RecommendationDraft, f: RetailBusinessFacts): TruthLevel {
  if (draft.truthLevel === "measured_conclusion" && (f.coveragePct ?? 0) < 60) return "strong_inference";
  return draft.truthLevel;
}

function finalize(draft: RecommendationDraft, pb: KnowledgePlaybook, f: RetailBusinessFacts, opts: ReasoningOptions): RetailRecommendation {
  const truthLevel = classifyTruth(draft, f);
  // confidence = min(draft, playbook ceiling, coverage ceiling); a hypothesis never exceeds medium
  let confidence = minConf(minConf(draft.confidence, pb.confidenceCeiling), coverageCeiling(f));
  if (truthLevel === "experiment_hypothesis") confidence = minConf(confidence, "medium");

  const reviewDays = opts.reviewPeriodDays ?? draft.durationDays ?? pb.minTestDurationDays;
  const reviewDate = new Date(Date.parse(opts.today) + reviewDays * 86_400_000).toISOString().slice(0, 10);
  const dedupeKey = `${draft.type}:${slug(draft.affectedProducts[0] ?? draft.domain)}`;

  const impactBand = draft.financialImpactEgp != null ? Math.min(3, Math.floor(draft.financialImpactEgp / 5000)) : 0;
  const priorityScore = CONF_RANK[confidence] * 3 + TRUTH_RANK[truthLevel] + impactBand + (draft.missingInformation.length ? 0 : 1);

  return {
    ...draft,
    id: `${pb.id}:${slug(draft.affectedProducts[0] ?? "portfolio")}`,
    dedupeKey,
    playbookId: pb.id,
    truthLevel,
    confidence,
    confidenceCeiling: pb.confidenceCeiling,
    principles: draft.principles.length ? draft.principles : [pb.principle],
    reviewDate,
    persistEligible: true,
    priorityScore,
  };
}

/** Run the full reasoning pipeline. */
export function runRetailReasoning(f: RetailBusinessFacts, opts: ReasoningOptions): RetailRecommendation[] {
  const drafts: { draft: RecommendationDraft; pb: KnowledgePlaybook }[] = [];

  for (const pb of KNOWLEDGE_LIBRARY) {
    if (pb.global) {
      for (const d of pb.global(f)) drafts.push({ draft: d, pb });
    }
    if (pb.match && pb.build) {
      for (const p of f.products) {
        if (!pb.match(p, f)) continue;
        const d = pb.build(p, f);
        if (d) drafts.push({ draft: d, pb });
      }
    }
  }

  const finalized = drafts.map(({ draft, pb }) => finalize(draft, pb, f, opts));

  // gate → suppress low-value → dedupe (against open actions + within the set)
  const open = new Set(opts.openDedupeKeys ?? []);
  const seen = new Set<string>();
  const passed: RetailRecommendation[] = [];
  for (const r of finalized.sort((a, b) => b.priorityScore - a.priorityScore)) {
    if (!gateRecommendation(r, f).ok) continue;
    if (isLowValue(r)) continue;
    if (open.has(r.dedupeKey) || seen.has(r.dedupeKey)) continue;
    seen.add(r.dedupeKey);
    passed.push(r);
  }
  return passed.slice(0, opts.maxRecommendations ?? 8);
}

/** Diagnostic: what got suppressed and why (for tests / the quality view). */
export function reasoningDiagnostics(f: RetailBusinessFacts, opts: ReasoningOptions): { suppressed: { id: string; reasons: string[] }[] } {
  const suppressed: { id: string; reasons: string[] }[] = [];
  for (const pb of KNOWLEDGE_LIBRARY) {
    const build = (draft: RecommendationDraft | null) => {
      if (!draft) return;
      const r = finalize(draft, pb, f, opts);
      const g = gateRecommendation(r, f);
      const reasons = [...g.violations];
      if (isLowValue(r)) reasons.push("low value");
      if (reasons.length) suppressed.push({ id: r.id, reasons });
    };
    if (pb.global) pb.global(f).forEach(build);
    if (pb.match && pb.build) for (const p of f.products) if (pb.match(p, f)) build(pb.build(p, f));
  }
  return { suppressed };
}
