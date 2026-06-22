import { describe, it, expect } from "vitest";
import { bucketByMonth, dayOfWeekAverages, rollingAverage, topDays, inRange, sumTotals } from "@/core/read/analytics";

const pts = (xs: [string, number][]) => xs.map(([date, total]) => ({ date, total }));

describe("analytics aggregators", () => {
  it("buckets daily points by month", () => {
    expect(bucketByMonth(pts([["2026-05-30", 100], ["2026-06-01", 200], ["2026-06-15", 50]]))).toEqual([
      { label: "2026-05", value: 100 }, { label: "2026-06", value: 250 },
    ]);
  });
  it("averages by day of week (same weekday averages, others zero)", () => {
    const out = dayOfWeekAverages(pts([["2026-06-01", 100], ["2026-06-08", 300]])); // both same weekday (+7d)
    const nonzero = out.filter((d) => d.value > 0);
    expect(nonzero).toHaveLength(1);
    expect(nonzero[0].value).toBe(200);
  });
  it("computes a trailing rolling average", () => {
    expect(rollingAverage(pts([["2026-06-01", 10], ["2026-06-02", 20], ["2026-06-03", 30]]), 2).map((s) => s.value))
      .toEqual([10, 15, 25]);
  });
  it("ranks top days and drops zeros", () => {
    expect(topDays(pts([["2026-06-01", 0], ["2026-06-02", 500], ["2026-06-03", 1200]]), 2))
      .toEqual([{ date: "2026-06-03", total: 1200 }, { date: "2026-06-02", total: 500 }]);
  });
  it("filters/sums a range", () => {
    const p = pts([["2026-05-31", 9], ["2026-06-01", 100], ["2026-06-30", 50], ["2026-07-01", 7]]);
    const r = inRange(p, { from: "2026-06-01", to: "2026-06-30" });
    expect(sumTotals(r)).toBe(150);
  });
});
