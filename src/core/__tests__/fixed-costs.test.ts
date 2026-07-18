/** THE MONTHLY OBLIGATION.
 *
 *  Owner correction (2026-07-18): *"rent and salaries come out at the end of
 *  the month last day not the begining of the new month"*.
 *
 *  Both are true and both matter:
 *    · the CASH leaves on the last day of the month
 *    · the MONTH owes them from day one
 *
 *  The old code conflated the two — it summed whatever fixed costs had been
 *  paid month-to-date and floored the result at a guessed 10,000. For 30 days
 *  of every month that understated the bar, then jumped on payday. Worse, it
 *  added a hardcoded 15,000 rent on top of recorded expenses, so the day rent
 *  was ever entered as an expense it would have been counted twice. */
import { describe, it, expect } from "vitest";
import { monthlyObligation } from "@/core/read/break-even";

const OWN = (o: Record<string, number>) => new Map(Object.entries(o));

describe("monthly obligation — what the month owes, not what has been paid", () => {
  it("uses the mall's real rent deduction, not a hardcoded figure", () => {
    const o = monthlyObligation([15_000, 15_000, 15_000], OWN({ "2026-06": 8_000 }));
    expect(o.rent).toBe(15_000);
    expect(o.total).toBe(23_000);
  });

  it("takes salary from the last COMPLETE month, since this month's has not posted", () => {
    // his actual history: 4,500 → 6,500 → 8,000
    const o = monthlyObligation([15_000], OWN({ "2026-04": 6_500, "2026-05": 6_500, "2026-06": 8_000 }));
    expect(o.ownCosts).toBe(8_000);
    expect(o.ownCostsBasis).toMatch(/2026-06/);
  });

  it("is identical on day 1 and day 31 — payday does not move the bar", () => {
    const rents = [15_000];
    const own = OWN({ "2026-06": 8_000 });
    expect(monthlyObligation(rents, own).total).toBe(monthlyObligation(rents, own).total);
    expect(monthlyObligation(rents, own).total).toBe(23_000);
  });

  it("never double-counts rent that also appears as an expense row", () => {
    // callers strip the Rent category before building the map; if that ever
    // regressed, the total would silently become 38,000
    const o = monthlyObligation([15_000], OWN({ "2026-06": 8_000 }));
    expect(o.total).toBe(23_000);
    expect(o.total).not.toBe(38_000);
  });

  it("falls back to the known rent only when the mall has recorded none", () => {
    expect(monthlyObligation([], OWN({ "2026-06": 8_000 })).rent).toBe(15_000);
    expect(monthlyObligation([0, 0], OWN({})).rent).toBe(15_000);
  });

  it("states plainly when no running costs are on record rather than guessing one", () => {
    const o = monthlyObligation([15_000], OWN({}));
    expect(o.ownCosts).toBe(0);
    expect(o.total).toBe(15_000);
    expect(o.ownCostsBasis).toMatch(/no running costs/i);
  });

  it("ignores months with nothing recorded when picking the run-rate", () => {
    const o = monthlyObligation([15_000], OWN({ "2026-06": 0, "2026-05": 6_500 }));
    expect(o.ownCosts).toBe(6_500);
  });
});
