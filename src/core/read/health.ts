/** Health read-model — game-style, but every number is real. Category scores
 *  come from live reads; a category reports `null` (incomplete) rather than a
 *  fabricated value when its signal is missing. READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { todayCairo, monthBoundsCairo, lastMonthBoundsCairo, isoDaysAgo } from "@/core/time";
import { getRevenueTotal } from "./sales";
import { getProfitReadout } from "./profit";
import { getStockSummary } from "./stock";
import { getMissingData } from "./missing";

export type HealthColor = "good" | "warn" | "bad" | "none";
export interface HealthCategory {
  key: string; label: string;
  score: number | null;   // null = not enough data
  trend: number | null;   // signed % vs prior, when known
  reason: string;
  lift: string;
  color: HealthColor;
}
export interface HealthReport {
  overall: number | null;
  status: string;
  level: number | null;
  streakDays: number;
  categories: HealthCategory[];
  helping: { label: string; score: number }[];
  hurting: { label: string; score: number }[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const colorFor = (s: number | null): HealthColor => s == null ? "none" : s >= 80 ? "good" : s >= 55 ? "warn" : "bad";

/** Inputs for the pure scorer — all already-fetched primitives, no I/O. */
export interface HealthInputs {
  monthRev: number;
  lastRev: number;
  profit: { complete: boolean; margin: number | null; missingCostLines: number; uncoveredRevenue?: number };
  stock: { activeCount: number; costedCount: number; costedNonNegCount: number };
  issuesCount: number;
  streakDays: number;
  cash: { score: number | null; errPct: number };
}

/** PURE health composition. Every score is real; a category reports `null`
 *  (incomplete) rather than a fabricated number when its signal is missing.
 *  Overall excludes the "data quality" category from the "is it meaningful"
 *  test so a brand-new shop with only data gaps doesn't get a false score. */
export function composeHealth(i: HealthInputs): HealthReport {
  const cats: HealthCategory[] = [];

  // Revenue — growth vs last month (null growth = first tracked month)
  if (i.lastRev > 0 || i.monthRev > 0) {
    const growth = i.lastRev > 0 ? (i.monthRev - i.lastRev) / i.lastRev : null;
    const score = growth == null ? 60 : clamp(60 + growth * 200);
    cats.push({
      key: "revenue", label: "Revenue", score, trend: growth == null ? null : Math.round(growth * 100),
      reason: growth == null ? "First tracked month — building a baseline." : `Sales ${growth >= 0 ? "ahead of" : "behind"} last month.`,
      lift: "Log every sales day to sharpen the trend.", color: colorFor(score),
    });
  }
  // Profit / margin — margin is computed on COVERED revenue only (honest
  // denominator), so it is scoreable even when header-only days exist; the
  // unknown-COGS exposure is named in the reason instead of hidden.
  const profitScore = i.profit.margin != null ? clamp(i.profit.margin) : null;
  const uncov = Math.round(i.profit.uncoveredRevenue ?? 0);
  cats.push({
    key: "profit", label: "Profit", score: profitScore, trend: null,
    reason: profitScore == null
      ? (i.profit.missingCostLines > 0
        ? `Margin can't be scored — ${i.profit.missingCostLines} sold line(s) missing cost.`
        : "Margin can't be scored — no costed product lines this month.")
      : `Gross margin ${Math.round(i.profit.margin ?? 0)}% on costed sales${uncov >= 1 ? ` · EGP ${uncov.toLocaleString()} of revenue has no product detail` : ""}.`,
    lift: "Add cost to every sold product.", color: colorFor(profitScore),
  });
  // Cash accuracy — from the latest physical count
  cats.push({
    key: "cash", label: "Cash", score: i.cash.score, trend: null,
    reason: i.cash.score == null ? "No cash count yet." : `Counted cash within ${i.cash.errPct.toFixed(1)}% of expected.`,
    lift: "Count the drawer daily.", color: colorFor(i.cash.score),
  });
  // Inventory — share of active products fully costed and non-negative
  const stockScore = i.stock.activeCount ? clamp((i.stock.costedNonNegCount / i.stock.activeCount) * 100) : null;
  cats.push({
    key: "stock", label: "Inventory", score: stockScore, trend: null,
    reason: stockScore == null ? "No products yet." : `${i.stock.costedCount}/${i.stock.activeCount} products fully costed.`,
    lift: "Fix missing costs and negative stock.", color: colorFor(stockScore),
  });
  // Data quality — penalised per open gap
  const dataScore = clamp(100 - i.issuesCount * 12);
  cats.push({
    key: "data", label: "Data quality", score: dataScore, trend: null,
    reason: i.issuesCount === 0 ? "No open data gaps." : `${i.issuesCount} open gap(s) in Missing Data.`,
    lift: "Clear items in the Missing Data center.", color: colorFor(dataScore),
  });

  const scored = cats.filter((c): c is HealthCategory & { score: number } => c.score != null);
  const W: Record<string, number> = { revenue: 0.25, profit: 0.25, cash: 0.15, stock: 0.2, data: 0.15 };
  const wsum = scored.reduce((s, c) => s + (W[c.key] ?? 0.1), 0);
  const overallRaw = scored.length ? clamp(scored.reduce((s, c) => s + c.score * (W[c.key] ?? 0.1), 0) / wsum) : null;

  const meaningful = scored.filter((c) => c.key !== "data");
  const overall = meaningful.length ? overallRaw : null;
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return {
    overall,
    status: statusLabel(overall, meaningful.length),
    level: overall == null ? null : Math.floor(overall / 12) + 1,
    streakDays: i.streakDays,
    categories: cats,
    helping: sorted.filter((c) => c.score >= 75).slice(0, 3).map((c) => ({ label: c.label, score: c.score })),
    hurting: sorted.filter((c) => c.score < 75).slice(-3).reverse().map((c) => ({ label: c.label, score: c.score })),
  };
}

export async function getHealthReport(): Promise<HealthReport> {
  const month = monthBoundsCairo();
  const last = lastMonthBoundsCairo();
  const [monthRev, lastRev, profit, stock, issues, streakDays] = await Promise.all([
    getRevenueTotal(month), getRevenueTotal(last), getProfitReadout(month),
    getStockSummary(), getMissingData(), salesStreak(),
  ]);
  const cash = await cashAccuracy();
  const active = stock.positions.filter((p) => p.active);
  return composeHealth({
    monthRev, lastRev,
    profit: { complete: profit.complete, margin: profit.margin, missingCostLines: profit.missingCostLines, uncoveredRevenue: profit.uncoveredRevenue },
    stock: {
      activeCount: active.length,
      costedCount: active.filter((p) => p.hasCost).length,
      costedNonNegCount: active.filter((p) => p.hasCost && p.onHand >= 0).length,
    },
    issuesCount: issues.length, streakDays, cash,
  });
}

function statusLabel(overall: number | null, meaningful: number): string {
  if (overall == null || meaningful === 0) return "Not enough data yet";
  if (overall >= 85) return "Thriving";
  if (overall >= 70) return "Strong & steady";
  if (overall >= 50) return "Needs attention";
  return "At risk";
}

/** Consecutive days (ending today, Cairo) that have at least one sale. */
async function salesStreak(): Promise<number> {
  const { data, error } = await requireEngine()
    .from("sales").select("sale_date").is("voided_at", null)
    .gte("sale_date", isoDaysAgo(todayCairo(), 120)).order("sale_date", { ascending: false });
  if (error || !data) return 0;
  const have = new Set(data.map((r) => r.sale_date));
  let n = 0; let cur = todayCairo();
  // allow the streak to start today or yesterday
  if (!have.has(cur)) cur = isoDaysAgo(cur, 1);
  while (have.has(cur)) { n += 1; cur = isoDaysAgo(cur, 1); }
  return n;
}

/** Pure scoring for a cash count. When expected ≤ 0 the old percent formula
 *  divided by a non-positive number and flattered the score to 100 no matter
 *  what was counted — use the largest live magnitude as the denominator so a
 *  real discrepancy always registers. */
export function scoreCashAccuracy(expected: number, counted: number): { score: number; errPct: number } {
  const diff = Math.abs(counted - expected);
  const denom = Math.max(Math.abs(expected), Math.abs(counted), 1);
  const errPct = (diff / denom) * 100;
  return { score: clamp(100 - errPct * 4), errPct };
}

async function cashAccuracy(): Promise<{ score: number | null; errPct: number }> {
  const { data, error } = await requireEngine()
    .from("cash_reconciliations").select("counted_amount,expected_balance,difference,count_date")
    .order("count_date", { ascending: false }).limit(1);
  if (error || !data || data.length === 0) return { score: null, errPct: 0 };
  const r = data[0];
  return { ...scoreCashAccuracy(r.expected_balance, r.counted_amount) };
}
