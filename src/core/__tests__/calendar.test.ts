import { describe, it, expect } from "vitest";
import { computeCalendar } from "@/core/strategist/calendar";

describe("computeCalendar", () => {
  it("reports the correct weekday and non-weekend for a Sunday", () => {
    const c = computeCalendar("2026-07-05"); // a Sunday
    expect(c.dayOfWeek).toBe("Sunday");
    expect(c.isWeekend).toBe(false);
    expect(c.monthName).toBe("July");
  });

  it("flags the Egyptian weekend (Friday + Saturday)", () => {
    expect(computeCalendar("2026-07-10").isWeekend).toBe(true); // Friday
    expect(computeCalendar("2026-07-11").isWeekend).toBe(true); // Saturday
    expect(computeCalendar("2026-07-12").isWeekend).toBe(false); // Sunday
  });

  it("returns upcoming retail dates soonest-first with correct days-until", () => {
    const c = computeCalendar("2026-07-05");
    expect(c.upcoming.length).toBeGreaterThan(0);
    expect(c.upcoming[0].name).toBe("Back to school");
    expect(c.upcoming[0].daysUntil).toBe(76); // 2026-07-05 → 2026-09-19
    // monotonic non-decreasing days-until
    for (let i = 1; i < c.upcoming.length; i++) {
      expect(c.upcoming[i].daysUntil).toBeGreaterThanOrEqual(c.upcoming[i - 1].daysUntil);
    }
  });

  it("marks Islamic dates as approximate and never surfaces past events", () => {
    const c = computeCalendar("2026-07-05", 400, 20);
    const ramadan = c.upcoming.find((e) => e.name.startsWith("Ramadan"));
    expect(ramadan?.approx).toBe(true);
    expect(c.upcoming.every((e) => e.daysUntil >= 0)).toBe(true);
  });
});
