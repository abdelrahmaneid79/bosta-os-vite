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

export async function getHealthReport(): Promise<HealthReport> {
  const month = monthBoundsCairo();
  const last = lastMonthBoundsCairo();
  const [monthRev, lastRev, profit, stock, issues, streakDays] = await Promise.all([
    getRevenueTotal(month), getRevenueTotal(last), getProfitReadout(month),
    getStockSummary(), getMissingData(), salesStreak(),
  ]);
  const cash = await cashAccuracy();

  const cats: HealthCategory[] = [];

  // Revenue
  if (lastRev > 0 || monthRev > 0) {
    const growth = lastRev > 0 ? (monthRev - lastRev) / lastRev : null;
    cats.push({
      key: "revenue", label: "Revenue",
      score: growth == null ? 60 : clamp(60 + growth * 200),
      trend: growth == null ? null : Math.round(growth * 100),
      reason: growth == null ? "First tracked month — building a baseline." : `Sales ${growth >= 0 ? "ahead of" : "behind"} last month.`,
      lift: "Log every sales day to sharpen the trend.", color: colorFor(growth == null ? 60 : clamp(60 + growth * 200)),
    });
  }
  // Profit / margin
  cats.push({
    key: "profit", label: "Profit",
    score: profit.complete && profit.margin != null ? clamp(profit.margin) : null,
    trend: null,
    reason: profit.complete ? `Net margin ${Math.round(profit.margin ?? 0)}% after cost.` : `Margin can't be scored — ${profit.missingCostLines} sold line(s) missing cost.`,
    lift: "Add cost to every sold product.", color: colorFor(profit.complete && profit.margin != null ? clamp(profit.margin) : null),
  });
  // Cash accuracy
  cats.push({
    key: "cash", label: "Cash",
    score: cash.score, trend: null,
    reason: cash.score == null ? "No cash count yet." : `Counted cash within ${cash.errPct.toFixed(1)}% of expected.`,
    lift: "Count the drawer daily.", color: colorFor(cash.score),
  });
  // Stock health
  const activeStock = stock.positions.filter((p) => p.active);
  const stockScore = activeStock.length ? clamp((activeStock.filter((p) => p.hasCost && p.onHand >= 0).length / activeStock.length) * 100) : null;
  cats.push({
    key: "stock", label: "Inventory",
    score: stockScore, trend: null,
    reason: stockScore == null ? "No products yet." : `${activeStock.filter((p) => p.hasCost).length}/${activeStock.length} products fully costed.`,
    lift: "Fix missing costs and negative stock.", color: colorFor(stockScore),
  });
  // Data quality
  const dataScore = clamp(100 - issues.length * 12);
  cats.push({
    key: "data", label: "Data quality",
    score: dataScore, trend: null,
    reason: issues.length === 0 ? "No open data gaps." : `${issues.length} open gap(s) in Missing Data.`,
    lift: "Clear items in the Missing Data center.", color: colorFor(dataScore),
  });

  const scored = cats.filter((c): c is HealthCategory & { score: number } => c.score != null);
  const W: Record<string, number> = { revenue: 0.25, profit: 0.25, cash: 0.15, stock: 0.2, data: 0.15 };
  const wsum = scored.reduce((s, c) => s + (W[c.key] ?? 0.1), 0);
  const overall = scored.length ? clamp(scored.reduce((s, c) => s + c.score * (W[c.key] ?? 0.1), 0) / wsum) : null;

  const meaningful = scored.filter((c) => c.key !== "data");
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return {
    overall: meaningful.length ? overall : null,
    status: statusLabel(overall, meaningful.length),
    level: overall == null ? null : Math.floor(overall / 12) + 1,
    streakDays,
    categories: cats,
    helping: sorted.filter((c) => c.score >= 75).slice(0, 3).map((c) => ({ label: c.label, score: c.score })),
    hurting: sorted.filter((c) => c.score < 75).slice(-3).reverse().map((c) => ({ label: c.label, score: c.score })),
  };
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

async function cashAccuracy(): Promise<{ score: number | null; errPct: number }> {
  const { data, error } = await requireEngine()
    .from("cash_reconciliations").select("counted_amount,expected_balance,difference,count_date")
    .order("count_date", { ascending: false }).limit(1);
  if (error || !data || data.length === 0) return { score: null, errPct: 0 };
  const r = data[0];
  const diff = r.difference ?? (r.counted_amount - r.expected_balance);
  const errPct = r.expected_balance > 0 ? Math.abs(diff) / r.expected_balance * 100 : 0;
  return { score: clamp(100 - errPct * 4), errPct };
}
