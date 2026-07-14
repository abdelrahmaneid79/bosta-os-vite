/** Cycle 8 persistence: daily closes, live-ops config, accepted financial
 *  commitments feeding the obligation calendar. The only module touching
 *  daily_closes and the live_operations app_setting. */
import { requireEngine } from "@/core/db/engine";
import { setAppSetting } from "@/core/db/mutations";
import { logAudit } from "@/core/audit/log";
import type { AcceptedCommitment } from "../analysis/cash";

/* ── live-operations start date ───────────────────────────────────────── */

export interface LiveOpsSettings { startDate: string; confirmedAt: string; reason?: string }
export async function confirmLiveStart(startDate: string, reason?: string): Promise<void> {
  await setAppSetting("live_operations", { startDate, confirmedAt: new Date().toISOString(), reason: reason ?? null });
}
export async function proposeLiveStart(startDate: string): Promise<void> {
  // proposed = date set but not confirmed (basis stays "proposed" in the snapshot)
  await setAppSetting("live_operations", { startDate });
}

/* ── daily closes ─────────────────────────────────────────────────────── */

export interface DailyCloseRow { date: string; status: string; completeness: number; nextAction: string | null; version: number; isStale: boolean }
export async function getRecentCloses(limit = 14): Promise<DailyCloseRow[]> {
  const { data, error } = await requireEngine()
    .from("daily_closes").select("close_date,status,completeness,next_action,version,is_stale")
    .is("voided_at", null).order("close_date", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ date: r.close_date, status: r.status, completeness: Number(r.completeness), nextAction: r.next_action, version: r.version ?? 1, isStale: r.is_stale ?? false }));
}

/* ── daily-close lifecycle (Cycle 9) ──────────────────────────────────── */

export interface SaveCloseInput {
  locationId: string | null;
  date: string;
  status: "open" | "ready" | "complete" | "partial" | "estimated" | "no_trading" | "reopened";
  completeness: number;
  confidence: "high" | "medium" | "low";
  autoDetected: unknown;          // the derived checklist snapshot
  confirmations: Record<string, unknown>;
  unresolved: string[];
  nextAction: string | null;
  sourceDataAt: string | null;
  keyNumbers?: Record<string, unknown> | null;
}

/** location_id is nullable (single-owner default) — null needs `.is`, a real id
 *  needs `.eq`. */
function byLoc<Q extends { eq: (c: "location_id", v: string) => Q; is: (c: "location_id", v: null) => Q }>(q: Q, locationId: string | null): Q {
  return locationId == null ? q.is("location_id", null) : q.eq("location_id", locationId);
}

async function priorVersion(locationId: string | null, date: string): Promise<number> {
  const q = requireEngine().from("daily_closes").select("version").eq("close_date", date);
  const { data } = await byLoc(q, locationId).maybeSingle();
  return data?.version ?? 0;
}

/** Persist a close, bumping the version and capturing the evaluated snapshot,
 *  source-data watermark and owner confirmations. 'ready' is normalised to
 *  'complete' on save (ready is a pre-save recommendation). */
export async function saveClose(i: SaveCloseInput): Promise<void> {
  const version = (await priorVersion(i.locationId, i.date)) + 1;
  const status = i.status === "ready" ? "complete" : i.status;
  const { error } = await requireEngine().from("daily_closes").upsert({
    location_id: i.locationId, close_date: i.date, status,
    completeness: i.completeness, confidence: i.confidence,
    checklist: (i.autoDetected ?? []) as never, auto_detected: (i.autoDetected ?? []) as never,
    confirmations: i.confirmations as never, unresolved: i.unresolved as never,
    next_action: i.nextAction, key_numbers: (i.keyNumbers ?? null) as never,
    source_data_at: i.sourceDataAt, version, is_stale: false, stale_reason: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "location_id,close_date" });
  if (error) throw error;
  void logAudit({ action: "close.complete", entityType: "daily_closes", entityId: i.date, detail: { status, completeness: i.completeness, version } });
}

export async function reopenDailyClose(locationId: string | null, date: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error("Reopening a close requires a reason.");
  const version = (await priorVersion(locationId, date)) + 1;
  const q = requireEngine().from("daily_closes")
    .update({ status: "reopened", version, reopened_at: new Date().toISOString(), reopen_reason: reason.trim(), is_stale: false, stale_reason: null, updated_at: new Date().toISOString() })
    .eq("close_date", date).is("voided_at", null);
  const { error } = await byLoc(q, locationId);
  if (error) throw error;
  void logAudit({ action: "close.reopen", entityType: "daily_closes", entityId: date, detail: { reason, version } });
}

export async function voidDailyClose(locationId: string | null, date: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error("Voiding a close requires a reason.");
  const q = requireEngine().from("daily_closes")
    .update({ voided_at: new Date().toISOString(), void_reason: reason.trim(), updated_at: new Date().toISOString() })
    .eq("close_date", date).is("voided_at", null);
  const { error } = await byLoc(q, locationId);
  if (error) throw error;
  void logAudit({ action: "close.void", entityType: "daily_closes", entityId: date, detail: { reason } });
}

/** Owner confirms the store did not trade — the one no-trading fact BostaOS
 *  cannot derive. */
export async function confirmNoTradingDay(locationId: string | null, date: string): Promise<void> {
  await saveClose({
    locationId, date, status: "no_trading", completeness: 100, confidence: "high",
    autoDetected: [{ key: "no_trading", ok: true }], confirmations: { noTrading: true }, unresolved: [],
    nextAction: null, sourceDataAt: null,
  });
}

/* ── overdue accepted actions (recommendation execution tracking) ─────── */

export interface OverdueAction { id: string; title: string; screenLink: string; amount: number | null }

/** Accepted/in-progress actions whose review date has passed without
 *  completion — the canonical exception engine turns these into
 *  action_overdue exceptions. */
export async function getOverdueActions(today: string): Promise<OverdueAction[]> {
  const { data, error } = await requireEngine()
    .from("strategist_actions")
    .select("id,title,screen_link,amount,review_date,status")
    .in("status", ["accepted", "in_progress"])
    .not("review_date", "is", null)
    .lt("review_date", today);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, title: r.title, screenLink: r.screen_link ?? "/health", amount: (r.amount as number | null) ?? null,
  }));
}

/* ── accepted financial commitments → obligation calendar ─────────────── */

/** Accepted strategist actions carrying a real amount become obligations. */
export async function loadAcceptedCommitments(): Promise<AcceptedCommitment[]> {
  const { data, error } = await requireEngine()
    .from("strategist_actions")
    .select("title,amount,recurring_amount,expected_date,status")
    .in("status", ["accepted", "in_progress"]);
  if (error) throw error;
  const out: AcceptedCommitment[] = [];
  for (const r of data ?? []) {
    const one = r.amount as number | null;
    const rec = r.recurring_amount as number | null;
    const amt = (one ?? 0) + (rec ?? 0);
    if (amt > 0) out.push({ title: r.title, amount: amt, dueDate: (r.expected_date as string | null) ?? null });
  }
  return out;
}
