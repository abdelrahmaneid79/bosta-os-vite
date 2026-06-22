import { describe, it, expect } from "vitest";
import {
  dedupeDailySales, mergeDailySales, dedupeExpenses, dedupeBillsByRef, dedupeCheques, reconcile,
} from "@/core/accounting/brain";

describe("accounting brain — daily sales", () => {
  it("keeps one figure per day and de-duplicates double days (never sums)", () => {
    const out = dedupeDailySales([
      { date: "2024-12-03", total: 3403.17 },
      { date: "2024-12-03", total: 3403.17 }, // double day
      { date: "2024-12-02", total: 5180.89 },
      { date: null, total: 100 },             // skip
      { date: "2024-12-04", total: null },     // skip
    ]);
    expect(out.clean).toEqual([{ date: "2024-12-02", total: 5180.89 }, { date: "2024-12-03", total: 3403.17 }]);
    expect(out.dropped).toBe(1);
  });
  it("merges a secondary source only for missing days (authoritative wins)", () => {
    const primary = [{ date: "2026-05-23", total: 100 }, { date: "2026-05-24", total: 200 }];
    const secondary = [{ date: "2026-05-24", total: 999 }, { date: "2026-05-25", total: 300 }];
    const { merged, added } = mergeDailySales(primary, secondary);
    expect(added).toBe(1);
    expect(merged.find((s) => s.date === "2026-05-24")!.total).toBe(200); // primary kept
    expect(merged.map((s) => s.date)).toEqual(["2026-05-23", "2026-05-24", "2026-05-25"]);
  });
});

describe("accounting brain — expenses & bills", () => {
  it("de-duplicates identical expense rows across files", () => {
    const out = dedupeExpenses([
      { date: "2025-07-01", category: "Rent Expense", amount: 15000, vendor: "Hyper Hub" },
      { date: "2025-07-01", category: "Rent Expense", amount: 15000, vendor: "Hyper Hub" }, // dup from another file
      { date: "2025-06-15", category: "Packaging Boxes", amount: 2610, vendor: "KRNO" },
    ]);
    expect(out.kept).toBe(2);
    expect(out.dropped).toBe(1);
    expect(out.clean[0].category).toBe("Packaging Boxes");
  });
  it("collapses a per-line-item bill into one purchase by ref", () => {
    const out = dedupeBillsByRef([
      { ref: "B1", date: "2025-06-04", vendor: "Haitham Nuts", total: 10445 }, // line 1
      { ref: "B1", date: "2025-06-04", vendor: "Haitham Nuts", total: 10445 }, // line 2 (same bill)
      { ref: "B1", date: "2025-06-04", vendor: "Haitham Nuts", total: 10445 }, // line 3
      { ref: "B2", date: "2025-06-02", vendor: "Bebeto", total: 2355 },
    ]);
    expect(out.kept).toBe(2);
    expect(out.clean.reduce((s, p) => s + p.total, 0)).toBe(12800);
  });
});

describe("accounting brain — cheques & reconciliation", () => {
  it("de-duplicates cheques by date+amount", () => {
    const out = dedupeCheques([
      { date: "2025-06-01", amount: 109508.3 },
      { date: "2025-06-01", amount: 109508.3 },
      { date: "2025-06-11", amount: 65000.08 },
    ]);
    expect(out.kept).toBe(2);
  });
  it("produces a reconciliation snapshot with totals and range", () => {
    const r = reconcile(
      [{ date: "2024-10-30", total: 4359.76 }, { date: "2024-10-31", total: 5941.27 }],
      [{ date: "2025-07-01", category: "Rent", amount: 15000, vendor: null, notes: null }],
      [{ date: "2025-06-02", vendor: "Bebeto", total: 2355, ref: "B2" }],
      [{ date: "2025-06-01", amount: 109508.3 }],
    );
    expect(r.salesDays).toBe(2);
    expect(r.salesTotal).toBe(10301.03);
    expect(r.from).toBe("2024-10-30");
    expect(r.to).toBe("2024-10-31");
    expect(r.chequesTotal).toBe(109508.3);
  });
});
