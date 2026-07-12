/** Profit read-model — "hides, never lies".
 *
 *  Revenue = Σ sales.total_amount (day headers). COGS = Σ sale_items.cogs_at_sale
 *  on non-voided mapped lines of non-voided sales in range. The catch: most of
 *  history has day totals WITHOUT product lines, so revenue can exist with no
 *  COGS at all. That unknown exposure is now quantified, never hidden:
 *
 *    coveredRevenue   — revenue on days that HAVE ≥1 mapped line (COGS measurable)
 *    uncoveredRevenue — revenue on header-only days (COGS unknowable today)
 *    margin           — gross margin % computed on covered revenue ONLY
 *    grossProfit      — whole-range revenue − COGS, null unless the range is
 *                       fully covered AND no mapped line lacks a cost snapshot
 *
 *  Net profit = gross − operating expenses (voided excluded; personal
 *  withdrawals are NOT expenses and never appear here). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { getOperatingExpenseTotal } from "./expenses";
import { fetchAllRows, type DateRange } from "./common";

export interface ProfitReadout {
  revenue: number;
  cogs: number;
  grossProfit: number | null; // null when cost data incomplete for the WHOLE range
  margin: number | null;      // gross margin % on covered revenue (honest denominator)
  operatingExpenses: number;
  netProfit: number | null;   // gross − opex; null when gross is null
  netMargin: number | null;   // net margin %
  soldLines: number;
  missingCostLines: number;
  coveredRevenue: number;     // revenue on days with ≥1 mapped product line
  uncoveredRevenue: number;   // unknown-COGS exposure (header-only days)
  coveredPct: number | null;  // coveredRevenue / revenue
  complete: boolean;
  partialBefore: string | null; // bookkeeping start; data before it is revenue-only
}

/** Pure profit composition — "hides, never lies". Whole-range gross/net profit
 *  are null when any mapped line lacks a cost OR header-only days contribute
 *  revenue; the margin is still published, computed on covered revenue only.
 *  Personal withdrawals are NOT operating expenses and must be excluded upstream. */
export function composeProfit(input: {
  revenue: number; cogs: number; operatingExpenses: number; soldLines: number;
  missingCostLines: number; coveredRevenue?: number; partialBefore?: string | null;
}): ProfitReadout {
  const { revenue, cogs, operatingExpenses, soldLines, missingCostLines } = input;
  // Callers that predate coverage (tests, lifetime aggregates over line data
  // only) pass no coveredRevenue — treat all revenue as covered there.
  const coveredRevenue = input.coveredRevenue ?? revenue;
  const uncoveredRevenue = Math.max(0, revenue - coveredRevenue);
  const linesCosted = soldLines > 0 && missingCostLines === 0;
  const complete = linesCosted && uncoveredRevenue < 1; // < 1 EGP tolerance
  const grossProfit = complete ? revenue - cogs : null;
  const netProfit = grossProfit == null ? null : grossProfit - operatingExpenses;
  const coveredGross = linesCosted ? coveredRevenue - cogs : null;
  return {
    revenue, cogs, grossProfit,
    margin: coveredGross == null || coveredRevenue <= 0 ? null : (coveredGross / coveredRevenue) * 100,
    operatingExpenses, netProfit,
    netMargin: netProfit == null || revenue <= 0 ? null : (netProfit / revenue) * 100,
    soldLines, missingCostLines,
    coveredRevenue, uncoveredRevenue,
    coveredPct: revenue > 0 ? (coveredRevenue / revenue) * 100 : null,
    complete,
    partialBefore: input.partialBefore ?? null,
  };
}

/** `since` = the bookkeeping start date. Costs before it are incomplete, so the
 *  P&L is computed only from `since` onward (revenue + COGS + expenses all in the
 *  accounted window) and `partialBefore` is set so the UI can flag it. */
export async function getProfitReadout(range: DateRange, since?: string): Promise<ProfitReadout> {
  const sb = requireEngine();
  const partialBefore = since && range.from < since ? since : null;
  const eff: DateRange = { from: partialBefore ?? range.from, to: range.to };

  // Non-voided lines of non-voided sales in the accounted window. Inner-join
  // filter on the parent sale (never `.in(saleIds)` — URL explodes past
  // ~hundreds of days) and paged (PostgREST caps at 1000 rows per response).
  const items = await fetchAllRows((a, b) =>
    sb.from("sale_items")
      .select("sale_id,cogs_at_sale,product_id,sales!inner(sale_date,voided_at)")
      .is("voided_at", null)
      .is("sales.voided_at", null)
      .gte("sales.sale_date", eff.from)
      .lte("sales.sale_date", eff.to)
      .range(a, b),
  );

  let cogs = 0;
  let lines = 0;
  let missing = 0;
  const coveredSaleIds = new Set<string>();
  for (const r of items) {
    if (r.product_id == null) continue; // unmapped lines don't gate COGS completeness
    lines += 1;
    coveredSaleIds.add(r.sale_id);
    if (r.cogs_at_sale == null) missing += 1;
    else cogs += r.cogs_at_sale;
  }

  // Day headers in range — to split revenue into covered vs header-only days.
  const days = await fetchAllRows((a, b) =>
    sb.from("sales")
      .select("id,total_amount")
      .is("voided_at", null)
      .gte("sale_date", eff.from)
      .lte("sale_date", eff.to)
      .range(a, b),
  );
  let revenue = 0;
  let coveredRevenue = 0;
  for (const d of days) {
    revenue += d.total_amount;
    if (coveredSaleIds.has(d.id)) coveredRevenue += d.total_amount;
  }

  const operatingExpenses = await getOperatingExpenseTotal(eff);
  return composeProfit({ revenue, cogs, operatingExpenses, soldLines: lines, missingCostLines: missing, coveredRevenue, partialBefore });
}
