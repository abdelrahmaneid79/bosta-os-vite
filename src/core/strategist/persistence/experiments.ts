/** Retail experiment persistence — the ONLY module touching retail_experiments
 *  (Cycle 10). A hypothesis recommendation becomes a structured, evaluable test. */
import { requireEngine } from "@/core/db/engine";
import type { Experiment } from "../retail/contract";

export async function createExperiment(e: Experiment): Promise<string> {
  const { data, error } = await requireEngine().from("retail_experiments").insert({
    playbook_id: e.playbookId, title: e.title, domain: e.domain, rec_type: e.recType,
    product_ids: e.productIds, location: e.location, change_description: e.changeDescription,
    start_date: e.startDate, end_date: e.endDate, baseline: (e.baseline ?? null) as never,
    primary_metric: e.primaryMetric, secondary_metrics: e.secondaryMetrics as never,
    guardrail_metrics: e.guardrailMetrics as never, min_sample: e.minSample,
    success_threshold: e.successThreshold, failure_threshold: e.failureThreshold,
    stop_condition: e.stopCondition, status: e.status, owner_notes: e.ownerNotes,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

export interface ExperimentRow extends Experiment { id: string; createdAt: string }

export async function listExperiments(): Promise<ExperimentRow[]> {
  const { data, error } = await requireEngine().from("retail_experiments")
    .select("*").is("voided_at", null).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, playbookId: r.playbook_id, title: r.title, domain: r.domain, recType: r.rec_type,
    productIds: r.product_ids ?? [], location: r.location, changeDescription: r.change_description,
    startDate: r.start_date, endDate: r.end_date, baseline: (r.baseline as Record<string, number> | null) ?? null,
    primaryMetric: r.primary_metric, secondaryMetrics: (r.secondary_metrics as string[]) ?? [],
    guardrailMetrics: (r.guardrail_metrics as string[]) ?? [], minSample: r.min_sample,
    successThreshold: r.success_threshold, failureThreshold: r.failure_threshold, stopCondition: r.stop_condition,
    status: r.status as Experiment["status"], result: (r.result as Record<string, number> | null) ?? null,
    conclusion: r.conclusion, attributionConfidence: r.attribution_confidence as Experiment["attributionConfidence"],
    decision: r.decision as Experiment["decision"], ownerNotes: r.owner_notes, createdAt: r.created_at,
  }));
}

export async function updateExperiment(id: string, patch: Partial<Experiment>): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.result !== undefined) row.result = patch.result;
  if (patch.conclusion !== undefined) row.conclusion = patch.conclusion;
  if (patch.attributionConfidence !== undefined) row.attribution_confidence = patch.attributionConfidence;
  if (patch.decision !== undefined) row.decision = patch.decision;
  if (patch.ownerNotes !== undefined) row.owner_notes = patch.ownerNotes;
  if (patch.startDate !== undefined) row.start_date = patch.startDate;
  if (patch.endDate !== undefined) row.end_date = patch.endDate;
  const { error } = await requireEngine().from("retail_experiments").update(row as never).eq("id", id);
  if (error) throw error;
}

/** Dedupe keys already committed as a running/proposed experiment (rec_type +
 *  first product) so the engine won't re-suggest an in-flight test. */
export async function openExperimentDedupeKeys(): Promise<string[]> {
  const rows = await listExperiments();
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return rows.filter((r) => r.status === "proposed" || r.status === "running")
    .map((r) => `${r.recType}:${slug(r.productIds[0] ?? r.domain)}`);
}
