/** Operational-exception lifecycle persistence — the ONLY module touching the
 *  operational_exceptions table (Cycle 9). Stores the canonical lifecycle so a
 *  dismissal, acknowledgement or note survives across refreshes, and a resolved
 *  issue reopens deterministically if the underlying problem returns. */
import { requireEngine } from "@/core/db/engine";
import { logAudit } from "@/core/audit/log";
import type { PersistedExceptionState, ReconciledException, OperationalException } from "../analysis/exceptions";

export async function loadPersistedExceptions(): Promise<PersistedExceptionState[]> {
  const { data, error } = await requireEngine()
    .from("operational_exceptions")
    .select("id,status,first_seen_at,last_seen_at,recurrence_count,last_severity_rank,dismiss_reason,suppressed_until,owner_note,resolved_at");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    status: r.status as PersistedExceptionState["status"],
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    recurrenceCount: r.recurrence_count,
    lastSeverityRank: r.last_severity_rank,
    dismissReason: r.dismiss_reason,
    suppressedUntil: r.suppressed_until,
    ownerNote: r.owner_note,
    resolvedAt: r.resolved_at,
  }));
}

export type ExceptionMeta = Pick<OperationalException, "type" | "severity" | "title" | "amountEgp">;

/** Persist the reconciled lifecycle: upsert every state (with its live meta),
 *  and mark auto-resolved ids. Idempotent — same inputs → same rows. */
export async function syncExceptionLifecycle(
  upserts: PersistedExceptionState[],
  meta: Map<string, ExceptionMeta>,
  now: string,
): Promise<void> {
  if (!upserts.length) return;
  const rows = upserts.map((s) => {
    const m = meta.get(s.id);
    return {
      id: s.id,
      type: m?.type ?? "books_stale",
      severity: m?.severity ?? "low",
      title: m?.title ?? "",
      last_amount: m?.amountEgp ?? null,
      status: s.status,
      first_seen_at: s.firstSeenAt,
      last_seen_at: s.lastSeenAt,
      recurrence_count: s.recurrenceCount,
      last_severity_rank: s.lastSeverityRank,
      dismiss_reason: s.dismissReason,
      suppressed_until: s.suppressedUntil,
      owner_note: s.ownerNote,
      resolved_at: s.resolvedAt,
      reopened_at: s.status === "reopened" ? now : null,
      updated_at: now,
    };
  });
  const { error } = await requireEngine().from("operational_exceptions").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

/* ── owner lifecycle actions ───────────────────────────────────────────── */

async function patch(id: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await requireEngine().from("operational_exceptions")
    .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export const acknowledgeException = (id: string) => patch(id, { status: "acknowledged", acknowledged_at: new Date().toISOString() })
  .then(() => void logAudit({ action: "exception.acknowledge", entityType: "operational_exceptions", entityId: id }));
export const startException = (id: string) => patch(id, { status: "in_progress" });
export const resolveException = (id: string) => patch(id, { status: "resolved", resolved_at: new Date().toISOString() })
  .then(() => void logAudit({ action: "exception.resolve", entityType: "operational_exceptions", entityId: id }));

/** Dismiss with a reason. Low-risk issues stay suppressed; critical issues can
 *  be dismissed but will reopen automatically if they persist (handled by the
 *  reconciler), so a reason is always required here. */
export async function dismissException(id: string, reason: string, suppressDays = 30): Promise<void> {
  if (!reason.trim()) throw new Error("A dismissal reason is required.");
  const until = new Date(Date.now() + suppressDays * 86_400_000).toISOString().slice(0, 10);
  await patch(id, { status: "dismissed", dismissed_at: new Date().toISOString(), dismiss_reason: reason.trim(), suppressed_until: until });
  void logAudit({ action: "exception.dismiss", entityType: "operational_exceptions", entityId: id, detail: { reason } });
}

export const noteException = (id: string, note: string) => patch(id, { owner_note: note });
export const linkExceptionAction = (id: string, actionId: string) => patch(id, { linked_action_id: actionId });

/** Convenience: reduce visible exceptions to lifecycle meta for sync. */
export function metaFrom(list: (OperationalException | ReconciledException)[]): Map<string, ExceptionMeta> {
  return new Map(list.map((e) => [e.id, { type: e.type, severity: e.severity, title: e.title, amountEgp: e.amountEgp }]));
}
