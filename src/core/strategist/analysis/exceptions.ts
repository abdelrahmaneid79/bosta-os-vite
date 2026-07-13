/** Canonical operational-exception engine — PURE Layer 2 (Cycle 9).
 *
 *  ONE model for every operational issue. Alerts, Missing-Data, the Strategist,
 *  the daily brief and notifications all consume THIS — they do not each run
 *  their own detection. It is BUILT FROM the existing pure signal engines
 *  (risk insights, missing-data, cash/cheque/close/obligation/action signals),
 *  so detection logic is never duplicated; this layer only normalises, assigns
 *  stable IDs, dedups and attaches resolution criteria + lifecycle.
 *
 *  Neutral language only (a cash shortage is a "difference", never theft). No
 *  fabricated numbers — every amount comes from a grounded signal. */
import type { Insight } from "@/core/insights/risk";
import type { MissingIssue } from "@/core/read/missing";

export type ExceptionType =
  | "sales_missing" | "suspicious_sales" | "sales_lines_mismatch" | "duplicate_sales_risk"
  | "missing_cogs" | "product_mapping_missing" | "purchase_not_linked" | "stale_cash_count"
  | "cash_difference" | "stale_inventory_count" | "stock_variance" | "cheque_overdue"
  | "settlement_discrepancy" | "daily_close_stale" | "import_awaiting_approval"
  | "obligation_overdue" | "action_overdue" | "critical_insight_unresolved" | "books_stale";

export type ExceptionSeverity = "critical" | "high" | "medium" | "low" | "info";
export type ExceptionUrgency = "today" | "this_week" | "monitor";
export type ExceptionStatus =
  | "open" | "acknowledged" | "in_progress" | "resolved" | "dismissed" | "reopened" | "suppressed";

export interface OperationalException {
  id: string;                 // STABLE deterministic (type + entity/date)
  type: ExceptionType;
  severity: ExceptionSeverity;
  urgency: ExceptionUrgency;
  source: string;             // producing engine
  title: string;
  detail: string;
  affectedDate: string | null;
  affectedEntity: string | null;
  amountEgp: number | null;
  confidence: "high" | "medium" | "low";
  resolutionAction: string;
  screenLink: string;
  resolutionCriteria: string;
}

export const SEVERITY_RANK: Record<ExceptionSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const URGENCY_RANK: Record<ExceptionUrgency, number> = { today: 0, this_week: 1, monitor: 2 };

function urgencyFor(sev: ExceptionSeverity): ExceptionUrgency {
  return sev === "critical" ? "today" : sev === "high" ? "this_week" : "monitor";
}

/* ── input bundle — whatever the caller can cheaply provide ────────────── */

export interface ExceptionInput {
  today: string;
  staleDays: number | null;
  lastDataDate: string | null;
  staleThresholdDays?: number;              // default 3
  insights?: Insight[];                     // core/insights/risk (stock/cash/trend/settlement)
  missing?: MissingIssue[];                 // core/read/missing
  importsAwaitingApproval?: number;
  staleCloses?: { date: string; status: string }[];
  cash?: { differenceUnresolved: boolean; amount: number | null; countAgeDays: number | null; freshnessDays: number };
  inventory?: { hasLiveData: boolean; lastCountDate: string | null; countAgeDays: number | null; staleDays: number };
  cheques?: { overduePeriods: string[]; unmatched: number };
  obligationsOverdue?: { title: string; amount: number; dueDate: string | null }[];
  actionsOverdue?: { id: string; title: string; screenLink: string; amount: number | null }[];
  criticalInsightsUnresolved?: { id: string; title: string; screenLink: string }[];
}

const missingSev: Record<MissingIssue["severity"], ExceptionSeverity> = { high: "high", medium: "medium", low: "low" };
const insightSev: Record<Insight["severity"], ExceptionSeverity> = { critical: "critical", warning: "medium", info: "low" };

/** Build the canonical exception list from grounded signals. Deterministic,
 *  deduped by stable id (first producer wins). */
export function composeExceptions(input: ExceptionInput): OperationalException[] {
  const out: OperationalException[] = [];
  const push = (e: OperationalException) => out.push(e);
  const staleThreshold = input.staleThresholdDays ?? 3;

  // ── books stale (current data older than live policy) ──────────────────
  if (input.staleDays != null && input.staleDays > staleThreshold) {
    push({
      id: "books_stale:current", type: "books_stale",
      severity: input.staleDays >= 7 ? "high" : "medium", urgency: "this_week", source: "freshness",
      title: `No sales recorded in ${input.staleDays} days`,
      detail: `The latest sales day on record is ${input.lastDataDate ?? "unknown"}. Days since then are not entered.`,
      affectedDate: input.lastDataDate, affectedEntity: null, amountEgp: null, confidence: "high",
      resolutionAction: "Enter or import the missing sales days (or mark closed days).", screenLink: "/sales/import",
      resolutionCriteria: "sales exist up to the current date, or the gap days are confirmed no-trading",
    });
  }

  // ── risk insights (stock / cash / settlement) — trend stays a finding ──
  for (const i of input.insights ?? []) {
    if (i.key.startsWith("trend")) continue;                 // trends are strategist findings, not exceptions
    const type: ExceptionType =
      i.key.startsWith("cash") ? "cash_difference"
        : i.key.startsWith("settle") ? "settlement_discrepancy"
          : i.key === "negative-stock" ? "stock_variance"
            : "stock_variance";
    push({
      id: `insight:${i.key}`, type,
      severity: insightSev[i.severity], urgency: urgencyFor(insightSev[i.severity]), source: "risk-insights",
      title: i.title, detail: i.detail,
      affectedDate: null, affectedEntity: null, amountEgp: null,
      confidence: i.confidence === "high" ? "high" : i.confidence === "estimate" ? "medium" : "low",
      resolutionAction: i.action, screenLink: i.route,
      resolutionCriteria: "the underlying signal clears on the next composition",
    });
  }

  // ── missing-data issues ────────────────────────────────────────────────
  for (const m of input.missing ?? []) {
    if (m.key === "negative-stock") continue;                // already an insight-derived stock_variance
    const type: ExceptionType =
      m.key === "unmapped" ? "product_mapping_missing"
        : m.key === "unreconciled-sales" ? "sales_lines_mismatch"
          : "missing_cogs";
    push({
      id: `missing:${m.key}`, type,
      severity: missingSev[m.severity], urgency: urgencyFor(missingSev[m.severity]), source: "missing-data",
      title: m.title, detail: m.detail,
      affectedDate: null, affectedEntity: null, amountEgp: null, confidence: "high",
      resolutionAction: m.action, screenLink: m.route,
      resolutionCriteria: type === "product_mapping_missing" ? "all sale lines are mapped to a product"
        : type === "sales_lines_mismatch" ? "each day's lines sum to the day total within tolerance"
          : "each sold product has a recorded cost",
    });
  }

  // ── imports awaiting approval ──────────────────────────────────────────
  if ((input.importsAwaitingApproval ?? 0) > 0) {
    push({
      id: "import_awaiting_approval:global", type: "import_awaiting_approval",
      severity: "medium", urgency: "this_week", source: "imports",
      title: `${input.importsAwaitingApproval} import(s) awaiting approval`,
      detail: "Imported data is staged but not approved — it is not counted until you approve it.",
      affectedDate: null, affectedEntity: null, amountEgp: null, confidence: "high",
      resolutionAction: "Review and approve or discard the staged import(s).", screenLink: "/imports",
      resolutionCriteria: "no import remains in the previewed state",
    });
  }

  // ── stale daily closes (completed then edited) ─────────────────────────
  for (const c of input.staleCloses ?? []) {
    push({
      id: `daily_close_stale:${c.date}`, type: "daily_close_stale",
      severity: "medium", urgency: "this_week", source: "daily-close",
      title: `Daily close for ${c.date} is stale`,
      detail: "A transaction for this day changed after it was closed. Reopen and re-close to keep the record accurate.",
      affectedDate: c.date, affectedEntity: null, amountEgp: null, confidence: "high",
      resolutionAction: "Reopen the close, review the change, and re-close.", screenLink: "/health",
      resolutionCriteria: "the close is re-completed against the current records",
    });
  }

  // ── unresolved cash difference ─────────────────────────────────────────
  if (input.cash?.differenceUnresolved) {
    const amt = input.cash.amount;
    push({
      id: "cash_difference:open", type: "cash_difference",
      severity: amt != null && Math.abs(amt) >= 200 ? "high" : "medium", urgency: "this_week", source: "cash",
      title: "Unresolved cash difference",
      detail: `Counted cash differs from the expected position${amt != null ? ` by ${Math.abs(amt).toLocaleString()} EGP` : ""}. It stays an open difference — never auto-cleared, never assumed to be an expense or withdrawal.`,
      affectedDate: null, affectedEntity: null, amountEgp: amt, confidence: "medium",
      resolutionAction: "Investigate the difference — link a movement, correct the count, or record it.", screenLink: "/money",
      resolutionCriteria: "the difference is explained, adjusted or explicitly recorded as reviewed",
    });
  }

  // ── stale cash count (policy freshness) ────────────────────────────────
  if (input.cash && input.cash.countAgeDays != null && input.cash.countAgeDays > input.cash.freshnessDays) {
    push({
      id: "stale_cash_count:current", type: "stale_cash_count",
      severity: "low", urgency: "this_week", source: "cash",
      title: `Cash count is ${input.cash.countAgeDays} days old`,
      detail: `Policy expects a count every ${input.cash.freshnessDays} days. A fresh count keeps cash confidence high.`,
      affectedDate: null, affectedEntity: null, amountEgp: null, confidence: "high",
      resolutionAction: "Count the drawer to refresh the cash baseline.", screenLink: "/money",
      resolutionCriteria: "a verified cash count exists within the freshness window",
    });
  }

  // ── stale inventory count ──────────────────────────────────────────────
  if (input.inventory?.hasLiveData && input.inventory.countAgeDays != null && input.inventory.countAgeDays > input.inventory.staleDays) {
    push({
      id: "stale_inventory_count:current", type: "stale_inventory_count",
      severity: "low", urgency: "monitor", source: "inventory",
      title: `Stock count is ${input.inventory.countAgeDays} days old`,
      detail: "Physical stock drifts from the ledger over time. A recount keeps inventory trustworthy.",
      affectedDate: input.inventory.lastCountDate, affectedEntity: null, amountEgp: null, confidence: "high",
      resolutionAction: "Recount stock to refresh the inventory baseline.", screenLink: "/settings/opening",
      resolutionCriteria: "a physical count exists within the freshness window",
    });
  }

  // ── cheques overdue ────────────────────────────────────────────────────
  for (const p of input.cheques?.overduePeriods ?? []) {
    push({
      id: `cheque_overdue:${p}`, type: "cheque_overdue",
      severity: "high", urgency: "this_week", source: "cheques",
      title: `Cheque overdue — ${p}`,
      detail: `The mall settlement for ${p} is past its expected window. Expected money is not available cash until it clears.`,
      affectedDate: null, affectedEntity: p, amountEgp: null, confidence: "medium",
      resolutionAction: "Chase the mall settlement and record the cheque when received.", screenLink: "/cheques",
      resolutionCriteria: "the settlement for this period is recorded or reconfirmed",
    });
  }

  // ── overdue obligations ────────────────────────────────────────────────
  for (const o of input.obligationsOverdue ?? []) {
    push({
      id: `obligation_overdue:${slug(o.title)}:${o.dueDate ?? "na"}`, type: "obligation_overdue",
      severity: "high", urgency: "this_week", source: "obligations",
      title: `Obligation overdue — ${o.title}`,
      detail: `A planned obligation of ${o.amount.toLocaleString()} EGP${o.dueDate ? ` due ${o.dueDate}` : ""} is past due.`,
      affectedDate: o.dueDate, affectedEntity: o.title, amountEgp: o.amount, confidence: "high",
      resolutionAction: "Pay/record the obligation, or reschedule it.", screenLink: "/money",
      resolutionCriteria: "the obligation is settled or its date is updated",
    });
  }

  // ── overdue accepted actions ───────────────────────────────────────────
  for (const a of input.actionsOverdue ?? []) {
    push({
      id: `action_overdue:${a.id}`, type: "action_overdue",
      severity: "medium", urgency: "this_week", source: "actions",
      title: `Action overdue — ${a.title}`,
      detail: "An accepted recommendation has passed its review date without being completed.",
      affectedDate: null, affectedEntity: a.title, amountEgp: a.amount, confidence: "high",
      resolutionAction: "Complete the action or update its status.", screenLink: a.screenLink,
      resolutionCriteria: "the action is completed or rescheduled",
    });
  }

  // ── unresolved critical insights ───────────────────────────────────────
  for (const c of input.criticalInsightsUnresolved ?? []) {
    push({
      id: `critical_insight_unresolved:${c.id}`, type: "critical_insight_unresolved",
      severity: "critical", urgency: "today", source: "strategist",
      title: c.title, detail: "A critical strategist finding is still open.",
      affectedDate: null, affectedEntity: null, amountEgp: null, confidence: "high",
      resolutionAction: "Open the finding and act on it.", screenLink: c.screenLink,
      resolutionCriteria: "the finding no longer appears in the report",
    });
  }

  // dedup by stable id (first producer wins), then rank
  const seen = new Set<string>();
  const deduped = out.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  return deduped.sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
    a.id.localeCompare(b.id));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

/* ── lifecycle reconciliation (Phase 9) ───────────────────────────────── */

export interface PersistedExceptionState {
  id: string;
  status: ExceptionStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  recurrenceCount: number;
  lastSeverityRank: number;
  dismissReason: string | null;
  suppressedUntil: string | null;   // ISO date; suppressed until then
  ownerNote: string | null;
  resolvedAt: string | null;
}

export interface ReconciledException extends OperationalException {
  status: ExceptionStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  recurrenceCount: number;
  ownerNote: string | null;
  isNew: boolean;
}

export interface LifecycleResult {
  visible: ReconciledException[];         // what the owner should see now
  upserts: PersistedExceptionState[];     // persist these
  autoResolvedIds: string[];              // were open, no longer live → resolved
}

const HIDDEN: ExceptionStatus[] = ["dismissed", "suppressed", "resolved"];

/** Merge freshly-composed live exceptions with their persisted lifecycle.
 *  Rules (Phase 9):
 *   - a brand-new live issue → open.
 *   - a previously RESOLVED issue that is live again → reopened.
 *   - a DISMISSED / SUPPRESSED issue stays hidden UNLESS it materially worsened
 *     (severity rank increased) or its suppression window elapsed → reopened.
 *   - a CRITICAL issue is never silently gone: if it was dismissed it reopens.
 *   - a persisted open/ack/in_progress/reopened issue no longer live →
 *     auto-resolved (manual state never overrides absent live data). */
export function reconcileLifecycle(
  live: OperationalException[],
  persisted: PersistedExceptionState[],
  now: string,
): LifecycleResult {
  const byId = new Map(persisted.map((p) => [p.id, p]));
  const liveIds = new Set(live.map((e) => e.id));
  const visible: ReconciledException[] = [];
  const upserts: PersistedExceptionState[] = [];
  const today = now.slice(0, 10);

  for (const e of live) {
    const rank = SEVERITY_RANK[e.severity];
    const prev = byId.get(e.id);
    if (!prev) {
      const state: PersistedExceptionState = { id: e.id, status: "open", firstSeenAt: now, lastSeenAt: now, recurrenceCount: 1, lastSeverityRank: rank, dismissReason: null, suppressedUntil: null, ownerNote: null, resolvedAt: null };
      upserts.push(state);
      visible.push(toReconciled(e, state, true));
      continue;
    }

    let status = prev.status;
    let recurrence = prev.recurrenceCount;
    const worsened = rank > prev.lastSeverityRank;
    const windowElapsed = prev.suppressedUntil != null && prev.suppressedUntil < today;

    if (status === "resolved") {
      status = "reopened"; recurrence += 1;                        // underlying returned
    } else if (status === "dismissed" || status === "suppressed") {
      if (worsened || windowElapsed || e.severity === "critical") {
        status = "reopened"; recurrence += 1;                      // materially worse / window over / critical never silent
      }
    }

    const state: PersistedExceptionState = {
      ...prev, status, recurrenceCount: recurrence, lastSeenAt: now,
      lastSeverityRank: Math.max(prev.lastSeverityRank, rank), resolvedAt: HIDDEN.includes(status) ? prev.resolvedAt : null,
    };
    upserts.push(state);
    if (!HIDDEN.includes(status)) visible.push(toReconciled(e, state, false));
  }

  // persisted issues that are no longer live and were still "active" → resolve
  const autoResolvedIds: string[] = [];
  for (const p of persisted) {
    if (liveIds.has(p.id)) continue;
    if (!HIDDEN.includes(p.status)) {
      autoResolvedIds.push(p.id);
      upserts.push({ ...p, status: "resolved", resolvedAt: now, lastSeenAt: p.lastSeenAt });
    }
  }

  visible.sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
    a.id.localeCompare(b.id));
  return { visible, upserts, autoResolvedIds };
}

function toReconciled(e: OperationalException, s: PersistedExceptionState, isNew: boolean): ReconciledException {
  return { ...e, status: s.status, firstSeenAt: s.firstSeenAt, lastSeenAt: s.lastSeenAt, recurrenceCount: s.recurrenceCount, ownerNote: s.ownerNote, isNew };
}
