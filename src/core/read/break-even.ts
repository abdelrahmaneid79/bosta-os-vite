/** LIVE BREAK-EVEN for the current month.
 *
 *  Answers the only question that matters day-to-day: "how much more do I need
 *  to sell this month before I'm actually earning?" — because with a large
 *  fixed base, profit is a small difference between two big numbers and a
 *  modest revenue dip wipes out most of it.
 *
 *  Contribution is revenue MINUS everything variable: COGS, the mall's revenue
 *  commission, and the flat per-pack packaging cost. Fixed costs (rent, salary,
 *  accountant) are applied only at break-even, never inside per-product margin.
 *  READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { todayCairo } from "@/core/time";
import { breakEven, type BreakEvenResult } from "@/core/strategist/retail/unit-economics";

/** Mall terms in force (Era 3: 3% of revenue + flat monthly rent). */
const COMMISSION_PCT = 0.03;
const MONTHLY_RENT = 15_000;
/** Floor for own operating costs (salary + accountant) when none are recorded
 *  yet for the month — better to slightly over-state the bar than to flatter it. */
const OPEX_FLOOR = 10_000;
/** Used only when a product has no recorded pack weight, so packaging can still
 *  be approximated rather than silently ignored. Measured stand average. */
const FALLBACK_PACK_G = 150;

export interface BreakEvenSnapshot extends BreakEvenResult {
  month: string;                 // YYYY-MM
  daysInMonth: number;
  daysElapsed: number;
  daysRemaining: number;
  /** revenue still needed to clear the fixed base; 0 once past it */
  revenueStillNeeded: number;
  /** average daily sales required across the remaining days to break even */
  requiredDailyRunRate: number | null;
  /** actual average daily sales so far this month */
  currentDailyRunRate: number;
  /** projected month-end revenue if the current pace holds */
  projectedRevenue: number;
  projectedProfit: number;
  /** % of the break-even bar already covered (can exceed 100) */
  progressPct: number;
}

export async function getBreakEven(): Promise<BreakEvenSnapshot> {
  const sb = requireEngine();
  const today = todayCairo();
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysElapsed = Number(today.slice(8, 10));
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

  // Trailing window: the contribution MARGIN is stable month to month, so the
  // break-even target is derived from it rather than from the current month —
  // otherwise on day 1 (or any month with no sales yet) the margin is 0 and the
  // target divides to Infinity, which is worse than useless.
  const trailingFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);

  const [dayTotals, lines, trailing, opexRows] = await Promise.all([
    // Authoritative revenue: the day total on the sale itself. Some days are
    // recorded as a total only (no product breakdown), so summing sale_items
    // would silently under-report them.
    sb.from("sales").select("total_amount")
      .is("voided_at", null)
      .gte("sale_date", `${month}-01`)
      .lte("sale_date", today),
    sb.from("sale_items")
      .select("quantity,line_total,products!inner(selling_price,avg_cost,pack_size_g,packaging_cost),sales!inner(sale_date)")
      .is("voided_at", null)
      .gte("sales.sale_date", `${month}-01`)
      .lte("sales.sale_date", today),
    sb.from("sale_items")
      .select("quantity,line_total,products!inner(selling_price,avg_cost,pack_size_g,packaging_cost),sales!inner(sale_date)")
      .is("voided_at", null)
      .gte("sales.sale_date", trailingFrom)
      .lte("sales.sale_date", today),
    sb.from("expenses")
      .select("amount,expense_date,expense_categories(name)")
      .is("voided_at", null)
      .gte("expense_date", `${month}-01`)
      .lte("expense_date", today),
  ]);
  if (dayTotals.error) throw dayTotals.error;
  if (lines.error) throw lines.error;
  if (trailing.error) throw trailing.error;
  if (opexRows.error) throw opexRows.error;

  type Row = { quantity: unknown; line_total: unknown; products: unknown };
  const tally = (rows: Row[] | null) => {
    let revenue = 0, contribution = 0;
    for (const row of rows ?? []) {
      const p = row.products as {
        selling_price: number | null; avg_cost: number | null;
        pack_size_g: number | null; packaging_cost: number | null;
      } | null;
      const qty = Number(row.quantity) || 0;
      revenue += Number(row.line_total) || 0;
      if (!p || p.selling_price == null || p.avg_cost == null || p.avg_cost <= 0) continue;
      const packKg = (p.pack_size_g ?? FALLBACK_PACK_G) / 1000;
      const packagingPerKg = packKg > 0 ? (p.packaging_cost ?? 0) / packKg : 0;
      contribution += qty * (p.selling_price * (1 - COMMISSION_PCT) - p.avg_cost - packagingPerKg);
    }
    return { revenue, contribution };
  };

  const mtd = tally(lines.data as Row[] | null);
  const hist = tally(trailing.data as Row[] | null);

  // Revenue always comes from the day totals. Contribution comes from product
  // lines where they exist; for revenue recorded as a day total only, it is
  // estimated at the trailing margin rather than dropped (which would make a
  // good month look like a loss).
  const revenue = (dayTotals.data ?? []).reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  const trailingCmRaw = hist.revenue > 0 ? hist.contribution / hist.revenue : 0;
  const uncoveredRevenue = Math.max(0, revenue - mtd.revenue);
  const contribution = mtd.contribution + uncoveredRevenue * trailingCmRaw;

  // Own operating costs, excluding stock buys (that's COGS) and packaging
  // (already charged per pack above) so nothing is counted twice.
  const opexRecorded = (opexRows.data ?? [])
    .filter((e) => {
      const cat = (e.expense_categories as unknown as { name?: string } | null)?.name ?? "";
      return cat !== "Inventory purchases" && cat !== "Packaging & stickers";
    })
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const fixedMonthly = MONTHLY_RENT + Math.max(opexRecorded, OPEX_FLOOR);

  // The TARGET uses the trailing margin (stable, and always available) so the
  // panel gives a real number on day 1 of the month. Actual profit still uses
  // this month's own contribution.
  const mtdCm = revenue > 0 ? contribution / revenue : 0;
  const cmFraction = trailingCmRaw > 0 ? trailingCmRaw : mtdCm;

  const breakEvenRevenue = cmFraction > 0 ? Math.round(fixedMonthly / cmFraction) : 0;
  const base = breakEven(revenue, contribution, fixedMonthly);
  // override the target with the trailing-margin one; keep this month's profit
  base.breakEvenRevenue = breakEvenRevenue;
  base.contributionMarginPct = Math.round(cmFraction * 1000) / 10;
  base.profitPer1000Revenue = Math.round(cmFraction * 1000);
  base.marginOfSafetyPct = breakEvenRevenue > 0
    ? Math.round(((revenue - breakEvenRevenue) / breakEvenRevenue) * 1000) / 10 : 0;
  base.status = base.profit > 0 ? (base.marginOfSafetyPct < 20 ? "thin" : "healthy") : "below";

  const revenueStillNeeded = Math.max(0, breakEvenRevenue - revenue);
  const currentDailyRunRate = daysElapsed > 0 ? revenue / daysElapsed : 0;
  const projectedRevenue = Math.round(currentDailyRunRate * daysInMonth);
  const projectedProfit = Math.round(projectedRevenue * cmFraction - fixedMonthly);

  return {
    ...base,
    month, daysInMonth, daysElapsed, daysRemaining,
    revenueStillNeeded,
    requiredDailyRunRate: daysRemaining > 0 ? Math.round(revenueStillNeeded / daysRemaining) : null,
    currentDailyRunRate: Math.round(currentDailyRunRate),
    projectedRevenue, projectedProfit,
    progressPct: base.breakEvenRevenue > 0 ? Math.round((revenue / base.breakEvenRevenue) * 100) : 0,
  };
}
