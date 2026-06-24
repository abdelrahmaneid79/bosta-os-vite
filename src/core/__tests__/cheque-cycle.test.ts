import { describe, it, expect } from "vitest";
import { buildChequeCycle, type ChequeIn, type DayRev } from "@/core/settlement/cheque-cycle";

// daily revenue: 100/day across the whole span for easy math
function flat(from: string, days: number, v = 100): DayRev[] {
  const out: DayRev[] = []; const d = new Date(from + "T00:00:00Z");
  for (let i = 0; i < days; i++) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + i); out.push({ date: x.toISOString().slice(0, 10), total: v }); }
  return out;
}

describe("buildChequeCycle", () => {
  const daily = flat("2025-01-01", 60, 100); // Jan 1 .. Mar 1, 100/day
  const cheques: ChequeIn[] = [
    { id: "a", date: "2025-01-20", amount: 1800 },
    { id: "b", date: "2025-02-05", amount: 1500 },
  ];
  const cy = buildChequeCycle(cheques, daily, "2025-02-20");

  it("first cheque has unknown coverage (no prior boundary)", () => {
    const first = cy.cheques.find((c) => c.id === "a")!;
    expect(first.coverFrom).toBeNull();
    expect(first.coverRevenue).toBeNull();
  });
  it("later cheque covers sales since the previous cheque, with implied deduction", () => {
    const b = cy.cheques.find((c) => c.id === "b")!;
    expect(b.coverFrom).toBe("2025-01-21");
    expect(b.coverTo).toBe("2025-02-05");
    expect(b.coverRevenue).toBe(1600); // 16 days × 100
    expect(b.impliedDeduction).toBe(100); // 1600 − 1500
    expect(b.deductionPct).toBeCloseTo(6.25, 2);
  });
  it("open tab = sales since the last cheque through today", () => {
    expect(cy.openTab.from).toBe("2025-02-06");
    expect(cy.openTab.to).toBe("2025-02-20");
    expect(cy.openTab.revenue).toBe(1500); // 15 days × 100
  });
  it("reports the pre-cheque cash era (sales before the first cheque)", () => {
    expect(cy.cashEra).not.toBeNull();
    expect(cy.cashEra!.from).toBe("2025-01-01");
    expect(cy.cashEra!.to).toBe("2025-01-19");
    expect(cy.cashEra!.revenue).toBe(1900); // 19 days × 100
  });
  it("totals received + blended deduction over known windows", () => {
    expect(cy.totalReceived).toBe(3300);
    expect(cy.blendedDeductionPct).toBeCloseTo(6.25, 2);
  });
  it("no cheques → everything is the open tab, no cash era", () => {
    const c2 = buildChequeCycle([], daily, "2025-02-20");
    expect(c2.cheques).toEqual([]);
    expect(c2.cashEra).toBeNull();
    expect(c2.openTab.from).toBe("2025-01-01");
  });
});
