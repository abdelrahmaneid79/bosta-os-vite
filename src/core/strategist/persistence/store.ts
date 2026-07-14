/** Strategist persistence store — the ONLY module that touches the
 *  strategist_* tables. Executes the pure plans from lifecycle.ts.
 *  Stores references/outputs/state — never authoritative financial numbers. */
import { requireEngine } from "@/core/db/engine";
import { setAppSetting } from "@/core/db/mutations";
import { logAudit } from "@/core/audit/log";
import type { Finding } from "../analysis/types";
import type { StrategistResponse } from "../response";
import { planInsightSync, isDuplicateAction, type InsightLite, type InsightStatus, type ActionLite } from "./lifecycle";
import { planOutcomeEvaluation, type ActionOutcomeRow } from "./outcomes";

/* ── insights ─────────────────────────────────────────────────────────── */

export interface InsightRow {
  id: string; findingId: string; class: string; title: string; detail: string;
  evidence: unknown[]; impactEgp: number | null; urgency: string; confidence: string;
  screenLink: string; status: InsightStatus; firstSeenAt: string; lastSeenAt: string;
  seenCount: number; ownerNote: string | null; period: string | null;
}

const mapInsight = (r: Record<string, unknown>): InsightRow => ({
  id: r.id as string, findingId: r.finding_id as string, class: r.class as string,
  title: r.title as string, detail: r.detail as string,
  evidence: (r.evidence as unknown[]) ?? [], impactEgp: r.impact_egp as number | null,
  urgency: r.urgency as string, confidence: r.confidence as string,
  screenLink: r.screen_link as string, status: r.status as InsightStatus,
  firstSeenAt: r.first_seen_at as string, lastSeenAt: r.last_seen_at as string,
  seenCount: r.seen_count as number, ownerNote: r.owner_note as string | null,
  period: r.period as string | null,
});

/** Reconcile persistent insights with the latest deterministic output. */
export async function syncInsights(findings: Finding[], period: string): Promise<void> {
  const sb = requireEngine();
  const { data, error } = await sb.from("strategist_insights").select("id,finding_id,status,seen_count");
  if (error) throw error;
  const existing: InsightLite[] = (data ?? []).map((r) => ({ id: r.id, findingId: r.finding_id, status: r.status as InsightStatus }));
  const seenById = new Map((data ?? []).map((r) => [r.id, r.seen_count as number]));
  const plan = planInsightSync(existing, findings);
  const now = new Date().toISOString();

  for (const f of plan.inserts) {
    const { error: e } = await sb.from("strategist_insights").insert({
      finding_id: f.id, class: f.class, title: f.title, detail: f.detail,
      evidence: f.evidence as never, impact_egp: f.impactEgp, urgency: f.urgency,
      confidence: f.confidence, screen_link: f.action?.screenLink ?? f.evidence[0]?.screenLink ?? "/health", period,
    });
    if (e && e.code !== "23505") throw e; // unique race: another tab synced first
  }
  for (const { rowId, finding: f } of plan.recurs) {
    const { error: e } = await sb.from("strategist_insights").update({
      title: f.title, detail: f.detail, evidence: f.evidence as never, impact_egp: f.impactEgp,
      urgency: f.urgency, confidence: f.confidence, last_seen_at: now, period,
      seen_count: (seenById.get(rowId) ?? 1) + 1,
    }).eq("id", rowId);
    if (e) throw e;
  }
  for (const { rowId, finding: f } of plan.reopens) {
    await sb.from("strategist_insights").update({
      status: "reopened", title: f.title, detail: f.detail, evidence: f.evidence as never,
      impact_egp: f.impactEgp, urgency: f.urgency, confidence: f.confidence,
      last_seen_at: now, resolved_at: null, period,
    }).eq("id", rowId);
  }
  for (const rowId of plan.autoResolves) {
    await sb.from("strategist_insights").update({ status: "resolved", resolved_at: now }).eq("id", rowId);
  }
}

export async function listInsights(): Promise<InsightRow[]> {
  const { data, error } = await requireEngine()
    .from("strategist_insights").select("*").order("last_seen_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []).map(mapInsight);
}

export async function setInsightStatus(id: string, status: InsightStatus, ownerNote?: string): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "dismissed") patch.dismissed_at = new Date().toISOString();
  if (status === "resolved") patch.resolved_at = new Date().toISOString();
  if (ownerNote !== undefined) patch.owner_note = ownerNote;
  const { error } = await requireEngine().from("strategist_insights").update(patch as never).eq("id", id);
  if (error) throw error;
}

/* ── actions ──────────────────────────────────────────────────────────── */

export interface ActionRow {
  id: string; title: string; description: string; source: string; findingId: string | null;
  category: string; priority: string; status: string; dueDate: string | null;
  screenLink: string; expectedOutcome: string | null; completionNote: string | null;
  createdAt: string; completedAt: string | null;
  outcomeState: string; successCriteria: string | null; reviewDate: string | null;
  outcomeMetrics: Record<string, unknown> | null;
}
const mapAction = (r: Record<string, unknown>): ActionRow => ({
  id: r.id as string, title: r.title as string, description: r.description as string,
  source: r.source as string, findingId: r.finding_id as string | null,
  category: r.category as string, priority: r.priority as string, status: r.status as string,
  dueDate: r.due_date as string | null, screenLink: r.screen_link as string,
  expectedOutcome: r.expected_outcome as string | null, completionNote: r.completion_note as string | null,
  createdAt: r.created_at as string, completedAt: r.completed_at as string | null,
  outcomeState: (r.outcome_state as string) ?? "not_started",
  successCriteria: r.success_criteria as string | null,
  reviewDate: r.review_date as string | null,
  outcomeMetrics: r.outcome_metrics as Record<string, unknown> | null,
});

export interface NewAction {
  title: string; description?: string; source: "finding" | "ai" | "owner" | "data_quality";
  findingId?: string | null; conversationId?: string | null; category?: string;
  priority?: "high" | "medium" | "low"; dueDate?: string | null;
  screenLink?: string; expectedOutcome?: string | null; status?: "suggested" | "accepted";
  /** the originating finding — captured as the immutable outcome baseline */
  baselineFinding?: Finding | null;
  reviewPeriodDays?: number;
  /** Cycle 8 — structured financial amounts (accepted → obligation calendar) */
  amount?: number | null;
  recurringAmount?: number | null;
  recurrence?: "once" | "monthly" | "weekly" | null;
  expectedDate?: string | null;
  latestDate?: string | null;
}

/** Create an action; silently returns the existing one on a duplicate open finding. */
export async function createAction(a: NewAction): Promise<{ created: boolean }> {
  const sb = requireEngine();
  if (a.findingId) {
    const { data } = await sb.from("strategist_actions").select("id,finding_id,status").eq("finding_id", a.findingId);
    const existing: ActionLite[] = (data ?? []).map((r) => ({ id: r.id, findingId: r.finding_id, status: r.status }));
    if (isDuplicateAction(existing, a.findingId)) return { created: false };
  }
  const f = a.baselineFinding ?? null;
  const reviewDays = a.reviewPeriodDays ?? 14;
  const reviewDate = new Date(Date.now() + reviewDays * 86_400_000).toISOString().slice(0, 10);
  const { error } = await sb.from("strategist_actions").insert({
    title: a.title, description: a.description ?? "", source: a.source,
    finding_id: a.findingId ?? null, conversation_id: a.conversationId ?? null,
    category: a.category ?? "general", priority: a.priority ?? "medium",
    status: a.status ?? "accepted", due_date: a.dueDate ?? null,
    accepted_at: (a.status ?? "accepted") === "accepted" ? new Date().toISOString() : null,
    screen_link: a.screenLink ?? "/health", expected_outcome: a.expectedOutcome ?? null,
    baseline: f ? ({ period: f.evidence[0]?.period ?? "", capturedAt: new Date().toISOString(), impactEgp: f.impactEgp, evidence: f.evidence, findingId: f.id, resolutionCriteria: f.resolutionCriteria } as never) : null,
    success_criteria: f?.resolutionCriteria ?? null,
    review_date: f ? reviewDate : null,
    amount: a.amount ?? null,
    recurring_amount: a.recurringAmount ?? null,
    recurrence: a.recurrence ?? null,
    expected_date: a.expectedDate ?? null,
    latest_date: a.latestDate ?? null,
    funding_status: "unfunded",
  });
  if (error) {
    if (error.code === "23505") return { created: false }; // race with the unique index
    throw error;
  }
  return { created: true };
}

export async function listActions(): Promise<ActionRow[]> {
  const { data, error } = await requireEngine()
    .from("strategist_actions").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []).map(mapAction);
}

export async function updateActionStatus(id: string, status: string, completionNote?: string): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  // Cycle 9 — execution timestamps so recommendation follow-through is measurable
  if (status === "accepted") patch.accepted_at = now;
  if (status === "in_progress") patch.started_at = now;
  if (status === "completed") { patch.completed_at = now; if (completionNote) patch.completion_note = completionNote; }
  if (status === "dismissed") patch.dismissed_at = now;
  const { error } = await requireEngine().from("strategist_actions").update(patch as never).eq("id", id);
  if (error) throw error;
  void logAudit({ action: "action.status_change", entityType: "strategist_actions", entityId: id, detail: { status, completionNote } });
}

/** Link an accepted action to the operational exception it resolves, so
 *  execution tracking can tell whether the issue actually cleared. */
export async function linkActionException(actionId: string, exceptionId: string): Promise<void> {
  const { error } = await requireEngine().from("strategist_actions")
    .update({ linked_exception_id: exceptionId } as never).eq("id", actionId);
  if (error) throw error;
}

/* ── conversations ────────────────────────────────────────────────────── */

export interface ConversationRow { id: string; title: string; mode: string; updatedAt: string }
export interface MessageRow {
  id: string; role: "user" | "assistant";
  content: { text?: string } | StrategistResponse;
  snapshotMeta: { generatedAt?: string; period?: string; lastDataDate?: string | null } | null;
  createdAt: string;
}

export async function createConversation(mode: string, title: string): Promise<string> {
  const sb = requireEngine();
  const { data, error } = await sb.from("strategist_conversations")
    .insert({ mode, title: title.slice(0, 120) }).select("id").single();
  if (error) throw error;
  // retention: keep the 30 most recent conversations
  const { data: all } = await sb.from("strategist_conversations").select("id").order("updated_at", { ascending: false });
  const stale = (all ?? []).slice(30).map((r) => r.id);
  if (stale.length) await sb.from("strategist_conversations").delete().in("id", stale);
  return data.id;
}

export async function addMessage(
  conversationId: string, role: "user" | "assistant",
  content: MessageRow["content"], snapshotMeta: MessageRow["snapshotMeta"],
): Promise<void> {
  const sb = requireEngine();
  const { error } = await sb.from("strategist_messages").insert({
    conversation_id: conversationId, role, content: content as never, snapshot_meta: snapshotMeta as never,
  });
  if (error) throw error;
  await sb.from("strategist_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
}

export async function listConversations(limit = 10): Promise<ConversationRow[]> {
  const { data, error } = await requireEngine()
    .from("strategist_conversations").select("id,title,mode,updated_at")
    .order("updated_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, title: r.title, mode: r.mode, updatedAt: r.updated_at }));
}

export async function getMessages(conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await requireEngine()
    .from("strategist_messages").select("*").eq("conversation_id", conversationId)
    .order("created_at", { ascending: true }).limit(50);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, role: r.role as "user" | "assistant",
    content: r.content as MessageRow["content"],
    snapshotMeta: r.snapshot_meta as MessageRow["snapshotMeta"], createdAt: r.created_at,
  }));
}

/* ── recommendation outcomes ──────────────────────────────────────────── */

/** Evaluate accepted recommendations against the CURRENT engine output.
 *  Deterministic — the LLM never judges whether a recommendation worked. */
export async function syncOutcomes(currentFindings: Finding[], today: string, coverageOk: boolean): Promise<number> {
  const sb = requireEngine();
  const { data, error } = await sb.from("strategist_actions")
    .select("id,finding_id,status,outcome_state,baseline,review_date")
    .not("finding_id", "is", null).not("baseline", "is", null);
  if (error) throw error;
  const rows: ActionOutcomeRow[] = (data ?? []).map((r) => ({
    id: r.id, findingId: r.finding_id, status: r.status,
    outcomeState: (r.outcome_state ?? "not_started") as ActionOutcomeRow["outcomeState"],
    baseline: r.baseline as ActionOutcomeRow["baseline"],
    reviewDate: r.review_date,
  }));
  const plan = planOutcomeEvaluation(rows, currentFindings, today, coverageOk);
  for (const u of plan) {
    const { error: e } = await sb.from("strategist_actions").update({
      outcome_state: u.outcomeState, outcome_metrics: u.outcomeMetrics as never,
      evaluated_at: new Date().toISOString(),
    }).eq("id", u.actionId);
    if (e) throw e;
  }
  return plan.length;
}

/* ── feedback ─────────────────────────────────────────────────────────── */

export async function recordFeedback(
  subjectType: "message" | "insight" | "briefing", subjectId: string | null,
  verdict: "useful" | "not_useful" | "incorrect" | "already_knew" | "acted_on",
  reason: string | null, snapshotMeta: MessageRow["snapshotMeta"],
): Promise<void> {
  const { error } = await requireEngine().from("strategist_feedback").insert({
    subject_type: subjectType, subject_id: subjectId, verdict, reason, snapshot_meta: snapshotMeta as never,
  });
  if (error) throw error;
}

/** Recent negative feedback with the answer headline it targeted — feeds the
 *  owner-memory block so future answers avoid repeated mistakes. */
export async function listRecentFeedback(limit = 10): Promise<{ verdict: string; reason: string | null; subjectTitle: string | null }[]> {
  const sb = requireEngine();
  const { data, error } = await sb.from("strategist_feedback")
    .select("verdict,reason,subject_type,subject_id")
    .in("verdict", ["incorrect", "not_useful"])
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const msgIds = (data ?? []).filter((r) => r.subject_type === "message" && r.subject_id).map((r) => r.subject_id as string);
  const titles = new Map<string, string>();
  if (msgIds.length) {
    const { data: msgs } = await sb.from("strategist_messages").select("id,content").in("id", msgIds);
    for (const m of msgs ?? []) {
      const c = m.content as { headline?: string } | null;
      if (c?.headline) titles.set(m.id, c.headline);
    }
  }
  return (data ?? []).map((r) => ({
    verdict: r.verdict, reason: r.reason,
    subjectTitle: r.subject_id ? titles.get(r.subject_id) ?? null : null,
  }));
}

/* ── cached AI briefing (app_settings) ────────────────────────────────── */

export interface CachedBriefing {
  response: StrategistResponse;
  snapshotMeta: { generatedAt: string; period: string; lastDataDate: string | null };
  generatedAt: string;
}
export async function getCachedBriefing(): Promise<CachedBriefing | null> {
  const { data } = await requireEngine().from("app_settings").select("value").eq("key", "strategist_briefing_v2").maybeSingle();
  const v = data?.value as CachedBriefing | null;
  return v && v.response && Array.isArray(v.response.priorities) ? v : null;
}
export const saveCachedBriefing = (b: CachedBriefing): Promise<void> => setAppSetting("strategist_briefing_v2", b);
