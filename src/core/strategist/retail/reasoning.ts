/** RETAIL REASONING ENGINE (Cycle 10) — PURE, zero API.
 *
 *  Builds deterministic candidates from the Retail Knowledge Library and routes
 *  them through the SHARED candidate intake (candidates.ts), which is the same
 *  gate model-authored candidates must pass. The engine never jumps from a weak
 *  signal to a confident recommendation: the intake caps confidence by playbook
 *  ceiling AND data coverage/freshness, forces "test X" moves to hypotheses,
 *  gates, suppresses noise, dedups and ranks. */
import type { RetailBusinessFacts, RetailRecommendation } from "./contract";
import { KNOWLEDGE_LIBRARY } from "./knowledge";
import { ingestCandidates, type Candidate, type IngestOptions, type IngestResult } from "./candidates";

export type ReasoningOptions = IngestOptions;

/** Deterministic knowledge → candidates (before validation/ranking). */
export function buildDeterministicCandidates(f: RetailBusinessFacts): Candidate[] {
  const out: Candidate[] = [];
  for (const pb of KNOWLEDGE_LIBRARY) {
    if (pb.global) for (const d of pb.global(f)) out.push({ draft: d, playbookId: pb.id, source: "deterministic_knowledge", confidenceCeiling: pb.confidenceCeiling });
    if (pb.match && pb.build) {
      for (const p of f.products) {
        if (!pb.match(p, f)) continue;
        const d = pb.build(p, f);
        if (d) out.push({ draft: d, playbookId: pb.id, source: "deterministic_knowledge", confidenceCeiling: pb.confidenceCeiling });
      }
    }
  }
  return out;
}

/** Deterministic-only reasoning (the default path). */
export function runRetailReasoning(f: RetailBusinessFacts, opts: ReasoningOptions): RetailRecommendation[] {
  return ingestCandidates(buildDeterministicCandidates(f), f, opts).accepted;
}

/** Reasoning over deterministic + externally-authored candidates (e.g. validated
 *  model ideas). Every candidate — whatever its source — passes the same gate. */
export function runReasoningWithCandidates(f: RetailBusinessFacts, opts: ReasoningOptions, extra: Candidate[]): IngestResult {
  return ingestCandidates([...buildDeterministicCandidates(f), ...extra], f, opts);
}

/** Diagnostic: what was rejected and why (for tests / the quality view). */
export function reasoningDiagnostics(f: RetailBusinessFacts, opts: ReasoningOptions): IngestResult["rejected"] {
  return ingestCandidates(buildDeterministicCandidates(f), f, { ...opts, maxRecommendations: 1000 }).rejected;
}
