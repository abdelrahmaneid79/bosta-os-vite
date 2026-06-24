/** Alert read-model — gathers live signals and composes them into one unified
 *  Alert list via the PURE engine (core/alerts/engine.ts). Reuses the existing
 *  risk + missing engines (no duplicated logic), drops the missing rows that the
 *  per-product/per-period risk insights already cover (avoids double-noise), and
 *  adds a "stale sales" alert that respects history (only fires off the latest
 *  recorded sale, so an old dataset never nags day-after-day). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { todayCairo } from "@/core/time";
import { getRiskInsights } from "./insights";
import { getMissingData } from "./missing";
import { getBudgetStatus } from "./budgets";
import { composeAlerts, type Alert } from "@/core/alerts/engine";

// Missing-issue keys already represented (richer) by risk insights.
const REDUNDANT_MISSING = new Set(["negative-stock", "settlements"]);

async function staleSalesAlerts(): Promise<Alert[]> {
  const sb = requireEngine();
  const { data, error } = await sb.from("sales").select("sale_date").is("voided_at", null)
    .order("sale_date", { ascending: false }).limit(1);
  if (error) throw error;
  const last = data?.[0]?.sale_date;
  if (!last) return [];
  const days = Math.round((Date.parse(todayCairo()) - Date.parse(last)) / 86_400_000);
  if (days <= 1) return [];
  return [{
    key: "stale-sales", severity: days >= 7 ? "warning" : "info", category: "data",
    title: `No sales recorded in ${days} days`,
    detail: `The latest sales day on record is ${last}. If you've been trading since, those days aren't entered yet.`,
    action: "Add the missing sales days", route: "/sales", metric: `${days}d`, confidence: "high",
  }];
}

async function budgetAlerts(): Promise<Alert[]> {
  try {
    const b = await getBudgetStatus();
    return b.alerts;
  } catch { return []; } // budgets are optional; never block the alert feed
}

/** Dismissed alert keys (cross-device). Resilient: returns [] if the table
 *  isn't present (older deploy) so the bell never breaks. */
export async function getDismissedAlertKeys(): Promise<string[]> {
  try {
    const { data, error } = await requireEngine().from("alert_dismissals").select("key");
    if (error) return [];
    return (data ?? []).map((r) => r.key);
  } catch { return []; }
}

export async function getAlerts(): Promise<Alert[]> {
  const [insights, missing, stale, budget] = await Promise.all([
    getRiskInsights(), getMissingData(), staleSalesAlerts(), budgetAlerts(),
  ]);
  return composeAlerts({
    insights,
    missing: missing.filter((m) => !REDUNDANT_MISSING.has(m.key)),
    extra: [...stale, ...budget],
  });
}
