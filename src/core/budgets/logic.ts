/**
 * BUDGETS & TARGETS (pure)
 * ------------------------
 * Owner-set monthly targets vs real month-to-date actuals. Pure + unit-tested:
 * the read-model passes in the actuals and how far through the month we are, and
 * this module decides progress, pace, status and any off-track alerts. Revenue
 * and profit are "higher is better"; expense budgets are "lower is better".
 * Profit target is skipped when profit is unknown (COGS incomplete) — never lie.
 */
import type { Alert } from "@/core/alerts/engine";

export interface Targets {
  monthlyRevenue: number | null;
  monthlyProfit: number | null;
  monthlyExpenseBudget: number | null;
  categoryBudgets: Record<string, number>; // category name → monthly cap
}

export const EMPTY_TARGETS: Targets = { monthlyRevenue: null, monthlyProfit: null, monthlyExpenseBudget: null, categoryBudgets: {} };

export function normalizeTargets(raw: unknown): Targets {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number | null => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
  const cats: Record<string, number> = {};
  if (o.categoryBudgets && typeof o.categoryBudgets === "object") {
    for (const [k, v] of Object.entries(o.categoryBudgets as Record<string, unknown>)) { const x = n(v); if (x != null) cats[k] = x; }
  }
  return { monthlyRevenue: n(o.monthlyRevenue), monthlyProfit: n(o.monthlyProfit), monthlyExpenseBudget: n(o.monthlyExpenseBudget), categoryBudgets: cats };
}

export type BudgetKind = "revenue" | "profit" | "expense";
export type BudgetStatus = "ahead" | "on-track" | "behind" | "over" | "unknown";
export interface BudgetRow {
  key: string; label: string; kind: BudgetKind;
  target: number; actual: number | null;
  progressPct: number;   // actual / target * 100 (clamped ≥0)
  pacePct: number;       // how far through the month (%), the "should-be-here" line
  status: BudgetStatus;
  remaining: number;     // target − actual (revenue/profit) or budget left (expense)
}

const clampPct = (n: number) => Math.max(0, Math.round(n));

/** elapsedFraction: 0..1 of the month elapsed (day/totalDays). For higher-is-
 *  better rows we compare progress to pace; for expenses we flag over/overspend. */
export function computeBudgetRow(
  key: string, label: string, kind: BudgetKind,
  target: number, actual: number | null, elapsedFraction: number,
): BudgetRow {
  const pace = Math.max(0, Math.min(1, elapsedFraction));
  const pacePct = clampPct(pace * 100);
  if (actual == null) {
    return { key, label, kind, target, actual: null, progressPct: 0, pacePct, status: "unknown", remaining: target };
  }
  const progressPct = clampPct((actual / target) * 100);
  let status: BudgetStatus;
  if (kind === "expense") {
    // lower is better: over budget, or spending faster than the month is elapsing
    if (actual > target) status = "over";
    else if (progressPct > pacePct + 10) status = "behind";
    else status = "on-track";
  } else {
    if (actual >= target) status = "ahead";
    else if (progressPct >= pacePct - 5) status = "on-track";
    else status = "behind";
  }
  const remaining = Math.round(target - actual);
  return { key, label, kind, target, actual, progressPct, pacePct, status, remaining };
}

export interface BudgetActuals {
  revenue: number;
  netProfit: number | null;   // null when COGS incomplete
  operatingExpenses: number;
  categorySpend: Record<string, number>;
}

export interface BudgetReadout { rows: BudgetRow[]; alerts: Alert[] }

/** Compose all configured budget rows + off-track alerts. */
export function composeBudgets(targets: Targets, actuals: BudgetActuals, elapsedFraction: number): BudgetReadout {
  const rows: BudgetRow[] = [];
  if (targets.monthlyRevenue != null) rows.push(computeBudgetRow("revenue", "Revenue target", "revenue", targets.monthlyRevenue, actuals.revenue, elapsedFraction));
  if (targets.monthlyProfit != null) rows.push(computeBudgetRow("profit", "Profit target", "profit", targets.monthlyProfit, actuals.netProfit, elapsedFraction));
  if (targets.monthlyExpenseBudget != null) rows.push(computeBudgetRow("expense", "Expense budget", "expense", targets.monthlyExpenseBudget, actuals.operatingExpenses, elapsedFraction));
  for (const [cat, cap] of Object.entries(targets.categoryBudgets)) {
    rows.push(computeBudgetRow(`cat:${cat}`, cat, "expense", cap, actuals.categorySpend[cat] ?? 0, elapsedFraction));
  }

  const alerts: Alert[] = [];
  for (const r of rows) {
    if (r.status === "over") {
      alerts.push({ key: `budget-over-${r.key}`, severity: "warning", category: "budget",
        title: `${r.label} exceeded`, detail: `Spent ${fmt(r.actual ?? 0)} against a ${fmt(r.target)} monthly budget.`,
        action: "Review spend on Reports", route: "/reports", metric: `${r.progressPct}%`, confidence: "high" });
    } else if (r.kind !== "expense" && r.status === "behind") {
      alerts.push({ key: `budget-behind-${r.key}`, severity: "info", category: "budget",
        title: `${r.label} behind pace`, detail: `At ${r.progressPct}% of ${fmt(r.target)} with the month ${r.pacePct}% gone.`,
        action: "Open Sales to push toward target", route: "/sales", metric: `${r.progressPct}%`, confidence: "estimate" });
    }
  }
  return { rows, alerts };
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n);
}
