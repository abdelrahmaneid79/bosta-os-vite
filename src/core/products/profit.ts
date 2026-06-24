/**
 * LIFETIME PRODUCT PROFITABILITY (pure)
 * -------------------------------------
 * Composes gross profit + margin for a product from its lifetime revenue/units
 * and a per-unit cost backfilled from supplier bills (Bill.xlsx). Cost source is
 * explicit and never faked: "verified" = resale good (bill cost is the COGS),
 * "estimate" = roasted nut/seed (raw supplier cost; excludes roasting loss +
 * packaging, so it's a close estimate), "unknown" = no confident cost mapping →
 * profit is withheld (null), never guessed. Deterministic + unit-tested.
 */
export type CostSource = "verified" | "estimate" | "unknown";

export interface LifetimeProfit {
  cogs: number | null;
  grossProfit: number | null;
  margin: number | null;      // % of revenue
  costSource: CostSource;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function composeLifetimeProfit(
  revenue: number, units: number, unitCost: number | null, costSource: CostSource,
): LifetimeProfit {
  if (unitCost == null || costSource === "unknown" || !(unitCost > 0)) {
    return { cogs: null, grossProfit: null, margin: null, costSource: "unknown" };
  }
  const cogs = r2(unitCost * units);
  const grossProfit = r2(revenue - cogs);
  const margin = revenue > 0 ? r2((grossProfit / revenue) * 100) : null;
  return { cogs, grossProfit, margin, costSource };
}

/** Profit-confidence label for the whole catalogue: share of revenue with a
 *  cost (verified counts full; estimate counts as 0.7 of its revenue weight). */
export function profitConfidence(rows: { revenue: number; costSource: CostSource }[]): { pct: number; label: "high" | "good" | "partial" | "low" } {
  const total = rows.reduce((s, r) => s + r.revenue, 0) || 1;
  const weighted = rows.reduce((s, r) => s + (r.costSource === "verified" ? r.revenue : r.costSource === "estimate" ? r.revenue * 0.7 : 0), 0);
  const pct = Math.round((weighted / total) * 100);
  const label = pct >= 85 ? "high" : pct >= 65 ? "good" : pct >= 35 ? "partial" : "low";
  return { pct, label };
}
