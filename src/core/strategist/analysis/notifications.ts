/** Notification foundation — PURE Layer 2 (Cycle 9, Phase 19).
 *
 *  INTERNAL only. No WhatsApp/email/push here — this projects canonical
 *  exceptions into notification-worthy events that the in-app alert bell and
 *  the daily brief consume first. External delivery is a later cycle. Each
 *  event carries its own dedup key + suppression window so a future channel
 *  won't spam. */
import type { OperationalException, ExceptionType, ExceptionSeverity } from "./exceptions";

export type NotificationType =
  | "daily_close_incomplete" | "cash_difference" | "stock_variance" | "cheque_overdue"
  | "reserve_risk" | "import_pending" | "critical_missing_data" | "action_overdue" | "books_stale";

const TYPE_MAP: Partial<Record<ExceptionType, NotificationType>> = {
  daily_close_stale: "daily_close_incomplete",
  cash_difference: "cash_difference",
  stock_variance: "stock_variance",
  cheque_overdue: "cheque_overdue",
  import_awaiting_approval: "import_pending",
  missing_cogs: "critical_missing_data",
  product_mapping_missing: "critical_missing_data",
  sales_lines_mismatch: "critical_missing_data",
  action_overdue: "action_overdue",
  obligation_overdue: "reserve_risk",
  books_stale: "books_stale",
};

export interface NotificationEvent {
  id: string;                 // stable — the exception id
  type: NotificationType;
  severity: ExceptionSeverity;
  title: string;
  body: string;
  screenLink: string;
  dedupKey: string;           // suppress duplicates within the window
  suppressWindowHours: number;
}

export type NotificationPrefs = Partial<Record<NotificationType, { enabled: boolean }>>;

const WINDOW: Record<ExceptionSeverity, number> = { critical: 6, high: 12, medium: 24, low: 72, info: 168 };

/** Project the visible exceptions into internal notification events, honouring
 *  owner preferences (default: all enabled). Deduped by exception id. */
export function projectNotifications(exceptions: OperationalException[], prefs: NotificationPrefs = {}): NotificationEvent[] {
  const out: NotificationEvent[] = [];
  const seen = new Set<string>();
  for (const e of exceptions) {
    const type = TYPE_MAP[e.type];
    if (!type) continue;
    if (prefs[type]?.enabled === false) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({
      id: e.id, type, severity: e.severity,
      title: e.title, body: e.resolutionAction, screenLink: e.screenLink,
      dedupKey: e.id, suppressWindowHours: WINDOW[e.severity],
    });
  }
  return out;
}
