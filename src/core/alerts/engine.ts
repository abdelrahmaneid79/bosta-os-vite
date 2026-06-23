/**
 * ALERT ENGINE (pure)
 * -------------------
 * One unified, status-aware alert model composed from the existing pure signal
 * engines (core/insights/risk.ts → Insight, core/read/missing.ts → MissingIssue)
 * plus a few feed-in extras (stale sales, budget off-track). No I/O here — the
 * read-model (core/read/alerts.ts) gathers data and feeds it in, so all the
 * judgement/dedupe/sort/dismiss logic stays deterministically unit-testable.
 *
 * Design rules honoured:
 *   - severity is explicit (critical/warning/info), never inflated
 *   - every alert carries a fix route + label (actionable, not decorative)
 *   - stable `key` so a dismissal persists across refreshes and an alert that
 *     stops being generated is treated as auto-resolved (just disappears)
 *   - historical-only states never nag (the read decides what's "live")
 */
import type { Insight, Severity as InsightSeverity, Confidence } from "@/core/insights/risk";
import type { MissingIssue, Severity as MissingSeverity } from "@/core/read/missing";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertCategory = "stock" | "cash" | "settlement" | "data" | "trend" | "budget" | "import";

export interface Alert {
  key: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail: string;
  action: string;       // fix label
  route: string;        // fix link
  metric?: string;
  confidence?: Confidence;
}

const SEV_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
const MISSING_SEV: Record<MissingSeverity, AlertSeverity> = { high: "critical", medium: "warning", low: "info" };

/** Derive a category from a signal key's prefix (keeps mapping in one place). */
export function categoryForKey(key: string): AlertCategory {
  if (key.startsWith("stock") || key === "negative-stock" || key === "missing-cogs") return "stock";
  if (key.startsWith("cash")) return "cash";
  if (key.startsWith("settle")) return "settlement";
  if (key.startsWith("trend")) return "trend";
  if (key.startsWith("budget")) return "budget";
  if (key.startsWith("import")) return "import";
  return "data";
}

export function fromInsight(i: Insight): Alert {
  const sev: AlertSeverity = i.severity as InsightSeverity; // identical union
  return { key: i.key, severity: sev, category: categoryForKey(i.key), title: i.title, detail: i.detail, action: i.action, route: i.route, metric: i.metric, confidence: i.confidence };
}

export function fromMissing(m: MissingIssue): Alert {
  return { key: `missing:${m.key}`, severity: MISSING_SEV[m.severity], category: categoryForKey(m.key), title: m.title, detail: m.detail, action: m.action, route: m.route, metric: m.count ? String(m.count) : undefined, confidence: "high" };
}

/** Merge all sources, dedupe by key (first wins), and sort by severity. */
export function composeAlerts(sources: { insights?: Insight[]; missing?: MissingIssue[]; extra?: Alert[] }): Alert[] {
  const all: Alert[] = [
    ...(sources.extra ?? []),
    ...(sources.insights ?? []).map(fromInsight),
    ...(sources.missing ?? []).map(fromMissing),
  ];
  const seen = new Set<string>();
  const deduped = all.filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true)));
  return deduped.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

export interface SeverityCounts { critical: number; warning: number; info: number; total: number }
export function severityCounts(alerts: Alert[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, warning: 0, info: 0, total: alerts.length };
  for (const a of alerts) c[a.severity] += 1;
  return c;
}

/** Split generated alerts into open vs dismissed using persisted dismissal keys.
 *  Dismissals for alerts no longer generated are returned as `stale` so the store
 *  can prune them (auto-resolved). */
export function partitionAlerts(alerts: Alert[], dismissedKeys: readonly string[]): { open: Alert[]; dismissed: Alert[]; staleKeys: string[] } {
  const dismissed = new Set(dismissedKeys);
  const open: Alert[] = [];
  const dismissedList: Alert[] = [];
  const live = new Set(alerts.map((a) => a.key));
  for (const a of alerts) (dismissed.has(a.key) ? dismissedList : open).push(a);
  const staleKeys = [...dismissed].filter((k) => !live.has(k));
  return { open, dismissed: dismissedList, staleKeys };
}

/** The single headline number for the bell: count of OPEN, non-info alerts
 *  (info-level signals are informational and shouldn't light up the bell). */
export function bellCount(openAlerts: Alert[]): number {
  return openAlerts.filter((a) => a.severity !== "info").length;
}
