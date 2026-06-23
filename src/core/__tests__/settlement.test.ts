import { describe, it, expect } from "vitest";
import { composeSettlement, suggestCheque, OVERDUE_DAYS, type ChequeLite } from "@/core/settlement/logic";

const ded = [{ type: "rent", amount: 15000, rate: null }, { type: "revenue_charge", amount: 3000, rate: 0.03 }];

describe("composeSettlement", () => {
  it("awaiting when no cheque received", () => {
    const v = composeSettlement({ revenue: 100000, deductions: ded, netExpected: 82000, cheques: [], periodEnd: "2026-01-31", today: "2026-02-10" });
    expect(v.status).toBe("awaiting");
    expect(v.expected).toBe(82000);
    expect(v.received).toBe(0);
    expect(v.outstanding).toBe(82000);
    expect(v.daysOutstanding).toBe(10);
    expect(v.overdue).toBe(false);
  });
  it("settled within tolerance", () => {
    const v = composeSettlement({ revenue: 100000, deductions: ded, netExpected: 82000, cheques: [{ id: "c", received: 82000, expected: 82000, date: "2026-02-05", status: "reconciled" }], periodEnd: "2026-01-31", today: "2026-02-10" });
    expect(v.status).toBe("settled");
    expect(v.outstanding).toBe(0);
    expect(v.daysOutstanding).toBeNull();
  });
  it("partial when received less than expected", () => {
    const v = composeSettlement({ revenue: 100000, deductions: ded, netExpected: 82000, cheques: [{ id: "c", received: 50000, expected: 50000, date: "2026-02-05", status: "received" }], periodEnd: "2026-01-31", today: "2026-02-10" });
    expect(v.status).toBe("partial");
    expect(v.outstanding).toBe(32000);
  });
  it("over when received exceeds expected beyond tolerance", () => {
    const v = composeSettlement({ revenue: 100000, deductions: ded, netExpected: 82000, cheques: [{ id: "c", received: 90000, expected: 82000, date: "2026-02-05", status: "received" }], periodEnd: "2026-01-31", today: "2026-02-10" });
    expect(v.status).toBe("over");
    expect(v.outstanding).toBeLessThan(0);
  });
  it("flags overdue past the threshold", () => {
    const end = "2026-01-31";
    const today = new Date(Date.parse(end) + (OVERDUE_DAYS + 5) * 86400000).toISOString().slice(0, 10);
    const v = composeSettlement({ revenue: 100000, deductions: ded, netExpected: 82000, cheques: [], periodEnd: end, today });
    expect(v.overdue).toBe(true);
  });
  it("sums multiple cheques and deductions", () => {
    const v = composeSettlement({ revenue: 100000, deductions: ded, netExpected: 82000, cheques: [{ id: "a", received: 40000, expected: 40000, date: "x", status: "received" }, { id: "b", received: 42000, expected: 42000, date: "y", status: "received" }], periodEnd: "2026-01-31", today: "2026-02-10" });
    expect(v.totalDeductions).toBe(18000);
    expect(v.received).toBe(82000);
    expect(v.status).toBe("settled");
  });
});

describe("suggestCheque", () => {
  const cands: ChequeLite[] = [
    { id: "a", received: 30000, expected: 30000, date: null, status: "received" },
    { id: "b", received: 81000, expected: 81000, date: null, status: "received" },
    { id: "c", received: 200000, expected: 200000, date: null, status: "received" },
  ];
  it("picks the closest cheque within band", () => {
    expect(suggestCheque(82000, cands)?.id).toBe("b");
  });
  it("returns null when nothing is close enough", () => {
    expect(suggestCheque(5000, cands)).toBeNull();
  });
});
