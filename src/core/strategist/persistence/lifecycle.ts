/** PURE insight-lifecycle + action-dedup logic. The store executes these
 *  plans; nothing here touches the network, so every rule is unit-testable.
 *
 *  Lifecycle: a finding with a stable id maps to ONE insight row.
 *    appears & qualifies      → insert (active)
 *    appears again            → recur (refresh evidence, bump seen_count)
 *    appears after resolved   → reopen
 *    appears after dismissed  → stay silent (the owner said stop)
 *    engine stops emitting it → auto-resolve (evidence-based, not manual) */
import type { Finding } from "../analysis/types";

export type InsightStatus = "active" | "acknowledged" | "resolved" | "dismissed" | "reopened";
export interface InsightLite { id: string; findingId: string; status: InsightStatus }

/** Persist only what deserves memory — not every transient observation. */
export function shouldPersistFinding(f: Finding): boolean {
  if (f.class === "contradiction" || f.class === "decision_risk") return true;
  if (f.urgency === "today") return true;
  if ((f.impactEgp ?? 0) >= 5_000) return true;
  if (f.class === "data_quality" && f.urgency !== "monitor") return true;
  return false;
}

export interface InsightSyncPlan {
  inserts: Finding[];
  /** rows to refresh with latest evidence + bump seen_count */
  recurs: { rowId: string; finding: Finding }[];
  /** resolved rows whose finding came back */
  reopens: { rowId: string; finding: Finding }[];
  /** open rows the engine no longer emits — evidence says it's gone */
  autoResolves: string[];
}

const OPEN: InsightStatus[] = ["active", "acknowledged", "reopened"];

export function planInsightSync(existing: InsightLite[], findings: Finding[]): InsightSyncPlan {
  const byFinding = new Map(existing.map((r) => [r.findingId, r]));
  const emitted = new Set(findings.map((f) => f.id));
  const plan: InsightSyncPlan = { inserts: [], recurs: [], reopens: [], autoResolves: [] };

  for (const f of findings) {
    if (!shouldPersistFinding(f)) continue;
    const row = byFinding.get(f.id);
    if (!row) plan.inserts.push(f);
    else if (row.status === "resolved") plan.reopens.push({ rowId: row.id, finding: f });
    else if (row.status === "dismissed") continue;
    else plan.recurs.push({ rowId: row.id, finding: f });
  }
  for (const row of existing) {
    if (OPEN.includes(row.status) && !emitted.has(row.findingId)) plan.autoResolves.push(row.id);
  }
  return plan;
}

/* ── actions ──────────────────────────────────────────────────────────── */

export interface ActionLite { id: string; findingId: string | null; status: string }
const OPEN_ACTION = ["suggested", "accepted", "in_progress"];

/** An action for a finding is a duplicate if one is already open for it. */
export function isDuplicateAction(existing: ActionLite[], findingId: string | null): boolean {
  if (!findingId) return false;
  return existing.some((a) => a.findingId === findingId && OPEN_ACTION.includes(a.status));
}

/* ── owner memory (facts worth carrying into future answers) ──────────── */

export interface MemoryInputs {
  completedActions: { title: string; completionNote: string | null; completedAt: string | null }[];
  rejectedFeedback: { verdict: string; reason: string | null; subjectTitle: string | null }[];
  dismissedInsights: { title: string; ownerNote: string | null }[];
}

/** Compact owner-memory facts. NEVER business numbers — those come from the
 *  live snapshot only; this is behavioral context (decisions, rejections). */
export function buildOwnerMemory(m: MemoryInputs, max = 10): string[] {
  const out: string[] = [];
  for (const a of m.completedActions.slice(0, 4)) {
    out.push(`Owner completed: "${a.title}"${a.completionNote ? ` — ${a.completionNote}` : ""}${a.completedAt ? ` (${a.completedAt.slice(0, 10)})` : ""}`);
  }
  for (const f of m.rejectedFeedback.slice(0, 3)) {
    if (f.verdict === "incorrect" || f.verdict === "not_useful") {
      out.push(`Owner rated ${f.subjectTitle ? `"${f.subjectTitle}"` : "an answer"} ${f.verdict === "incorrect" ? "INCORRECT" : "not useful"}${f.reason ? `: ${f.reason}` : ""} — avoid repeating that mistake.`);
    }
  }
  for (const d of m.dismissedInsights.slice(0, 3)) {
    out.push(`Owner dismissed the insight "${d.title}"${d.ownerNote ? ` (${d.ownerNote})` : ""} — do not re-raise it unless it materially worsens.`);
  }
  return out.slice(0, max);
}
