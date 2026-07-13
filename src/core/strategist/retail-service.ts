/** Retail reasoning service — Layer 2 orchestration (Cycle 10). Assembles the
 *  facts, runs the deterministic reasoning engine, applies experiment learning,
 *  and dedups against in-flight experiments. Zero API. */
import { requireEngine } from "@/core/db/engine";
import { todayCairo } from "@/core/time";
import type { StrategistSnapshot } from "./contract";
import type { StrategyReport } from "./analysis/report";
import type { RetailRecommendation, RetailBusinessFacts } from "./retail/contract";
import { assembleRetailFacts } from "./retail/facts";
import { runRetailReasoning } from "./retail/reasoning";
import { applyLearning, priorsFromExperiments } from "./retail/learning";
import { listExperiments, openExperimentDedupeKeys } from "./persistence/experiments";

export interface RetailResult {
  recommendations: RetailRecommendation[];
  facts: RetailBusinessFacts;
}

export async function assembleRetailRecommendations(s: StrategistSnapshot, report: StrategyReport): Promise<RetailResult> {
  const facts = await assembleRetailFacts(s, report);

  const [experiments, openKeys, nameById] = await Promise.all([
    listExperiments().catch(() => []),
    openExperimentDedupeKeys().catch(() => [] as string[]),
    productNameById().catch(() => new Map<string, string>()),
  ]);

  let recommendations = runRetailReasoning(facts, {
    today: todayCairo(),
    openDedupeKeys: openKeys,
    maxRecommendations: 8,
  });

  const priors = priorsFromExperiments(experiments, nameById);
  recommendations = applyLearning(recommendations, priors);

  return { recommendations, facts };
}

async function productNameById(): Promise<Map<string, string>> {
  const { data, error } = await requireEngine().from("products").select("id,name_en");
  if (error) return new Map();
  return new Map((data ?? []).map((p) => [p.id, p.name_en]));
}
