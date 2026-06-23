/** Budgets read-model — loads owner targets from app_settings.budgets, gathers
 *  real month-to-date actuals, and composes status + off-track alerts via the
 *  pure logic. Short-circuits cheaply when no targets are configured. READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { monthBoundsCairo, todayCairo } from "@/core/time";
import { getRevenueTotal } from "./sales";
import { getProfitReadout } from "./profit";
import { getExpenses } from "./expenses";
import { normalizeTargets, composeBudgets, type Targets, type BudgetReadout } from "@/core/budgets/logic";

export async function getTargets(): Promise<Targets> {
  const { data, error } = await requireEngine().from("app_settings").select("value").eq("key", "budgets").maybeSingle();
  if (error) throw error;
  return normalizeTargets(data?.value ?? null);
}

export interface BudgetStatus extends BudgetReadout { targets: Targets; configured: boolean }

export async function getBudgetStatus(): Promise<BudgetStatus> {
  const targets = await getTargets();
  const configured = targets.monthlyRevenue != null || targets.monthlyProfit != null
    || targets.monthlyExpenseBudget != null || Object.keys(targets.categoryBudgets).length > 0;
  if (!configured) return { targets, rows: [], alerts: [], configured };

  const month = monthBoundsCairo();
  const today = todayCairo();
  const [revenue, profit, expenses] = await Promise.all([
    getRevenueTotal(month), getProfitReadout(month), getExpenses(month),
  ]);
  const categorySpend: Record<string, number> = {};
  for (const e of expenses) categorySpend[e.category] = (categorySpend[e.category] ?? 0) + e.amount;
  const day = Number(today.slice(8, 10));
  const daysInMonth = Number(month.to.slice(8, 10));
  const elapsed = daysInMonth > 0 ? day / daysInMonth : 1;

  const { rows, alerts } = composeBudgets(
    targets,
    { revenue, netProfit: profit.netProfit, operatingExpenses: profit.operatingExpenses, categorySpend },
    elapsed,
  );
  return { targets, rows, alerts, configured };
}
