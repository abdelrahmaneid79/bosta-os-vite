/** Cycle 8 persistence: daily closes, live-ops config, accepted financial
 *  commitments feeding the obligation calendar. The only module touching
 *  daily_closes and the live_operations app_setting. */
import { requireEngine } from "@/core/db/engine";
import { setAppSetting } from "@/core/db/mutations";
import type { DailyCloseResult } from "../analysis/operations";
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

export async function saveDailyClose(locationId: string | null, result: DailyCloseResult, keyNumbers?: Record<string, unknown>): Promise<void> {
  const { error } = await requireEngine().from("daily_closes").upsert({
    location_id: locationId, close_date: result.date, status: result.status,
    completeness: result.completeness, checklist: result.checklist as never,
    key_numbers: (keyNumbers ?? null) as never, unresolved: result.unresolved as never,
    next_action: result.nextAction, updated_at: new Date().toISOString(),
  }, { onConflict: "location_id,close_date" });
  if (error) throw error;
}

export interface DailyCloseRow { date: string; status: string; completeness: number; nextAction: string | null }
export async function getRecentCloses(limit = 14): Promise<DailyCloseRow[]> {
  const { data, error } = await requireEngine()
    .from("daily_closes").select("close_date,status,completeness,next_action")
    .is("voided_at", null).order("close_date", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ date: r.close_date, status: r.status, completeness: Number(r.completeness), nextAction: r.next_action }));
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
