import { describe, it, expect } from "vitest";
import { bucketByMonth, dayOfWeekAverages, rollingAverage, topDays, inRange, sumTotals } from "@/core/read/analytics";
import { askBosta, type BostaContext } from "@/core/assistant/askBosta";

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

const ctx: BostaContext = {
  revenue: { today: 100, week: 700, month: 12000, lastMonth: 10000, all: 250000 },
  profitMonthNet: 4000, marginMonth: 33.3,
  expensesMonth: 8000, expensesLastMonth: 6000,
  cash: 5000, owed: 3000, rentMonthly: 15000,
  topProduct: { name: "Pistachio", revenue: 44000 },
  bestDay: { date: "2026-03-30", total: 17241 },
  lowStock: [{ name: "Cashew", onHand: 50, unit: "g" }],
};

describe("Ask Bosta intent answers", () => {
  it("answers profit", () => expect(askBosta("what's my profit this month?", ctx).text).toMatch(/4,000|4000/));
  it("answers today revenue", () => expect(askBosta("how much did I make today?", ctx).text).toMatch(/100/));
  it("answers month revenue by default", () => expect(askBosta("how much have I sold?", ctx).text).toMatch(/12,000|12000/));
  it("answers last month revenue", () => expect(askBosta("revenue last month?", ctx).text).toMatch(/10,000|10000/));
  it("answers expenses with comparison", () => expect(askBosta("how much did I spend?", ctx).text).toMatch(/up 33%|up 33/));
  it("answers cash", () => expect(askBosta("how much cash do I have?", ctx).text).toMatch(/5,000|5000/));
  it("answers cash after rent", () => expect(askBosta("cash after rent?", ctx).text).toMatch(/-10,000|−10,000|10000/));
  it("answers owed", () => expect(askBosta("what am I owed?", ctx).text).toMatch(/3,000|3000/));
  it("answers top product", () => expect(askBosta("best selling product?", ctx).text).toMatch(/Pistachio/));
  it("answers best day", () => expect(askBosta("what was my best day?", ctx).text).toMatch(/2026-03-30/));
  it("answers restock", () => expect(askBosta("what needs restocking?", ctx).text).toMatch(/Cashew/));
  it("answers growth comparison", () => expect(askBosta("am I doing better than last month?", ctx).text).toMatch(/up 20%/));
  it("falls back helpfully", () => expect(askBosta("what is the meaning of life", ctx).text).toMatch(/I can answer about/));
  it("withholds profit when unknown", () => {
    expect(askBosta("profit?", { ...ctx, profitMonthNet: null }).text).toMatch(/can't give a profit/);
  });
});
