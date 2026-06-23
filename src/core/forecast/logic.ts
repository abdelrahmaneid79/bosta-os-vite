/**
 * FORECASTING (pure)
 * ------------------
 * Projects near-term revenue from real history only, using day-of-week
 * seasonality on top of a recent daily level. Honest about uncertainty:
 * confidence is derived from how many real trading days we've observed, and we
 * never invent a projection from near-empty history. The read-model passes in a
 * daily series; all the math here is deterministic + unit-tested.
 *
 * Only trading days (revenue > 0) feed the average and day-of-week factors, so a
 * stale data window (e.g. no entries for the last few weeks) doesn't drag the
 * forecast to zero — it answers "if you trade like before, expect ~X".
 */
export interface DayPoint { date: string; total: number }
export type ForecastConfidence = "high" | "estimate" | "low-data";

export interface RevenueForecast {
  confidence: ForecastConfidence;
  tradingDays: number;       // real days with revenue in the window
  avgPerDay: number;         // mean revenue across trading days
  dowFactors: number[];      // Sun..Sat multiplier vs avg (1 = average day)
  next7: number;
  next30: number;
  basis: string;             // plain-English explanation of the inputs
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dowOf = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();
const r2 = (n: number) => Math.round(n * 100) / 100;

export function confidenceFor(tradingDays: number): ForecastConfidence {
  if (tradingDays >= 60) return "high";
  if (tradingDays >= 14) return "estimate";
  return "low-data";
}

/** Mean revenue per day-of-week (index 0=Sun..6=Sat), over trading days only.
 *  Days-of-week with no observations fall back to the overall average. */
export function dayOfWeekFactors(points: DayPoint[]): { factors: number[]; avg: number } {
  const trading = points.filter((p) => p.total > 0);
  if (trading.length === 0) return { factors: [1, 1, 1, 1, 1, 1, 1], avg: 0 };
  const avg = trading.reduce((s, p) => s + p.total, 0) / trading.length;
  const sums = Array(7).fill(0), counts = Array(7).fill(0);
  for (const p of trading) { const d = dowOf(p.date); sums[d] += p.total; counts[d] += 1; }
  const factors = sums.map((s, i) => (counts[i] > 0 && avg > 0 ? (s / counts[i]) / avg : 1));
  return { factors, avg };
}

/** Project the revenue of the `n` calendar days starting the day after `fromIso`. */
function projectForward(fromIso: string, n: number, avg: number, factors: number[]): number {
  let total = 0;
  const start = new Date(fromIso + "T00:00:00Z");
  for (let i = 1; i <= n; i++) {
    const d = new Date(start); d.setUTCDate(d.getUTCDate() + i);
    total += avg * factors[d.getUTCDay()];
  }
  return r2(total);
}

export function forecastRevenue(points: DayPoint[], today: string): RevenueForecast {
  const { factors, avg } = dayOfWeekFactors(points);
  const tradingDays = points.filter((p) => p.total > 0).length;
  const confidence = confidenceFor(tradingDays);
  const next7 = projectForward(today, 7, avg, factors);
  const next30 = projectForward(today, 30, avg, factors);
  const strongest = factors.reduce((m, f, i) => (f > factors[m] ? i : m), 0);
  const basis = tradingDays === 0
    ? "No trading days recorded yet — record daily sales to enable a forecast."
    : `Based on ${tradingDays} real trading day${tradingDays === 1 ? "" : "s"}, averaging ${Math.round(avg)} EGP/day. ${DOW[strongest]} is your strongest day (${(factors[strongest]).toFixed(2)}× average).`;
  return { confidence, tradingDays, avgPerDay: r2(avg), dowFactors: factors.map(r2), next7, next30, basis };
}
