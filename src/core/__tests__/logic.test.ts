import { describe, it, expect } from "vitest";
import { CAP, isEnabled, cap } from "@/core/capabilities";
import { reconTolerance } from "@/core/read/sales";
import { toIso, toNum, parseSalesRows, parseExpenseRows } from "@/core/import/csv";

describe("import CSV parsing", () => {
  it("normalizes dates and numbers", () => {
    expect(toIso("2026-06-01")).toBe("2026-06-01");
    expect(toIso("1/6/2026")).toBe("2026-06-01");
    expect(toIso("01-06-26")).toBe("2026-06-01");
    expect(toIso("nope")).toBeNull();
    expect(toNum("EGP 1,234.50")).toBe(1234.5);
    expect(toNum("")).toBeNull();
  });
  it("maps sales rows by header synonyms", () => {
    const rows = parseSalesRows([{ Date: "2026-06-01", "Grand Total": "4,200" }]);
    expect(rows[0]).toMatchObject({ date: "2026-06-01", total: 4200, issues: [] });
  });
  it("flags missing fields", () => {
    const rows = parseSalesRows([{ Date: "", Total: "" }]);
    expect(rows[0].issues).toContain("no date");
    expect(rows[0].issues).toContain("no total");
  });
  it("maps expense rows + defaults category", () => {
    const rows = parseExpenseRows([{ date: "2/6/2026", account: "Rent", amount: "15000" }]);
    expect(rows[0]).toMatchObject({ date: "2026-06-02", category: "Rent", amount: 15000 });
    expect(parseExpenseRows([{ date: "2026-06-02", amount: "10" }])[0].category).toBe("Other");
  });
});

describe("reconciliation tolerance = max(5, 0.5% of total)", () => {
  it("floors at 5 EGP for small days", () => {
    expect(reconTolerance(0)).toBe(5);
    expect(reconTolerance(500)).toBe(5); // 0.5% = 2.5 < 5
  });
  it("scales at 0.5% for large days", () => {
    expect(reconTolerance(2000)).toBe(10);
    expect(reconTolerance(100000)).toBe(500);
  });
});

describe("capability system", () => {
  it("Goods / Purchases / Sales creation are enabled", () => {
    expect(CAP.productCreate).toBe("enabled");
    expect(CAP.productEdit).toBe("enabled");
    expect(CAP.purchaseCreate).toBe("enabled");
    expect(CAP.saleCreate).toBe("enabled");
    expect(CAP.saleItemAdd).toBe("enabled");
  });
  it("Expenses / Cash / Cheques / Settings are enabled", () => {
    for (const k of ["expenseCreate", "cashCount", "withdrawal", "chequeRecord", "settlementOpen", "settingsEdit"] as const) {
      expect(isEnabled(k)).toBe(true);
    }
  });
  it("financial reversals are flagged risky (need confirmation)", () => {
    for (const k of ["saleItemVoid", "saleItemEdit", "saleVoid", "expenseVoid", "movementVoid", "chequeVoid"] as const) {
      expect(cap(k)).toBe("risky");
    }
  });
  it("imports are enabled (CSV preview → approve)", () => {
    expect(isEnabled("importApprove")).toBe(true);
  });
});
