/** The append-only, hash-chained audit trail (migration 0011/0013). Every
 *  high-value mutation writes one row here — voids, corrections, close
 *  lifecycle transitions, exception lifecycle, action status changes. This is
 *  the supplementary "who did what when" ledger on top of the per-row
 *  edited_at/voided_at/void_reason trail every table already carries.
 *
 *  Best-effort by design: a logging failure must never block a real mutation.
 *  The database itself is what makes this trustworthy (append-only trigger +
 *  SHA-256 hash chain, migration 0013) — the app only needs to write to it. */
import { requireEngine } from "@/core/db/engine";

export type AuditAction =
  | "sale.void" | "sale_item.void" | "sale_item.edit"
  | "expense.void" | "purchase.void" | "movement.void" | "cheque.void"
  | "cash_count.record" | "stock_count.record"
  | "close.complete" | "close.reopen" | "close.void"
  | "exception.acknowledge" | "exception.dismiss" | "exception.resolve"
  | "action.status_change" | "experiment.create" | "experiment.update"
  | "context.save" | "product.delete"
  | "bank.recategorise" | "bank.note";

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}

/** Write one audit row. Never throws — a broken audit write must not break the
 *  mutation it's describing. `actor` is the current session's user id when
 *  available, else null (RLS still scopes access; this is just attribution). */
export async function logAudit(e: AuditEntry): Promise<void> {
  try {
    const sb = requireEngine();
    const { data: auth } = await sb.auth.getUser();
    await sb.from("audit_log").insert({
      actor: auth?.user?.id ?? null,
      action: e.action,
      entity_type: e.entityType,
      entity_id: e.entityId ?? null,
      detail: (e.detail ?? null) as never,
    });
  } catch {
    // best-effort — swallow. The audit trail must never be why a real write failed.
  }
}
