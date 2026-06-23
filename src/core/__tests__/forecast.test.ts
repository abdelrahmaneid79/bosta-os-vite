import { describe, it, expect } from "vitest";
import { forecastRevenue, dayOfWeekFactors, confidenceFor, type DayPoint } from "@/core/forecast/logic";

// Build N consecutive days ending at `end`, each with `value` revenue.
function series(end: string, days: number, value: number): DayPoint[] {
  const out: DayPoint[] = [];
  const d = new Date(end + "T00:00:00Z");
  for (let i = days - 1; i >= 0; i--) { const x = new Date(d); x.setUTCDate(x.getUTCDate() - i); out.push({ date: x.toISOString().slice(0, 10), total: value }); }
  return out;
}

describe("confidenceFor", () => {
  it("tiers by observed trading days", () => {
    expect(confidenceFor(5)).toBe("low-data");
    expect(confidenceFor(14)).toBe("estimate");
    expect(confidenceFor(60)).toBe("high");
  });
});

describe("dayOfWeekFactors", () => {
  it("returns neutral factors with no trading days", () => {
    const { factors, avg } = dayOfWeekFactors([{ date: "2026-01-01", total: 0 }]);
    expect(avg).toBe(0);
    expect(factors).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
  it("flat revenue → all factors ≈ 1", () => {
    const { factors, avg } = dayOfWeekFactors(series("2026-03-31", 90, 1000));
    expect(avg).toBe(1000);
    factors.forEach((f) => expect(f).toBeCloseTo(1, 5));
  });
});

describe("forecastRevenue", () => {
  it("flat 1000/day for 90 days projects ~7k next7 / ~30k next30, high confidence", () => {
    const f = forecastRevenue(series("2026-03-31", 90, 1000), "2026-03-31");
    expect(f.confidence).toBe("high");
    expect(f.tradingDays).toBe(90);
    expect(f.avgPerDay).toBe(1000);
    expect(f.next7).toBeCloseTo(7000, 0);
    expect(f.next30).toBeCloseTo(30000, 0);
  });
  it("ignores empty future/gap days when averaging (uses trading days only)", () => {
    const pts = [...series("2026-03-31", 30, 2000), ...series("2026-05-31", 20, 0)];
    const f = forecastRevenue(pts, "2026-06-10");
    expect(f.avgPerDay).toBe(2000); // zero days excluded
    expect(f.tradingDays).toBe(30);
  });
  it("is honest with thin history", () => {
    const f = forecastRevenue(series("2026-01-05", 5, 500), "2026-01-05");
    expect(f.confidence).toBe("low-data");
    expect(f.basis).toMatch(/trading day/);
  });
  it("with no data, explains what's needed and projects nothing", () => {
    const f = forecastRevenue([], "2026-01-05");
    expect(f.tradingDays).toBe(0);
    expect(f.next7).toBe(0);
    expect(f.basis).toMatch(/record daily sales/i);
  });
});
