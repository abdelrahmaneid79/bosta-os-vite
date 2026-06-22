import { describe, it, expect } from "vitest";
import { CAP, isEnabled, cap } from "@/core/capabilities";
import { reconTolerance } from "@/core/read/sales";
import { toIso, toNum, parseSalesRows, parseExpenseRows } from "@/core/import/csv";
import { composeProfit } from "@/core/read/profit";
import { aggregateProductProfit } from "@/core/read/products";

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

describe("profit composition (gross + net, hides never lies)", () => {
  it("computes gross and net when costs are complete", () => {
    const p = composeProfit({ revenue: 10000, cogs: 4000, operatingExpenses: 2000, soldLines: 5, missingCostLines: 0 });
    expect(p.grossProfit).toBe(6000);
    expect(p.margin).toBeCloseTo(60);
    expect(p.netProfit).toBe(4000);
    expect(p.netMargin).toBeCloseTo(40);
    expect(p.complete).toBe(true);
  });
  it("withholds gross AND net when any sold line lacks cost", () => {
    const p = composeProfit({ revenue: 10000, cogs: 4000, operatingExpenses: 2000, soldLines: 5, missingCostLines: 1 });
    expect(p.grossProfit).toBeNull();
    expect(p.netProfit).toBeNull();
    expect(p.margin).toBeNull();
    expect(p.netMargin).toBeNull();
    expect(p.complete).toBe(false);
  });
  it("withholds profit when there are no sold lines at all", () => {
    const p = composeProfit({ revenue: 0, cogs: 0, operatingExpenses: 0, soldLines: 0, missingCostLines: 0 });
    expect(p.grossProfit).toBeNull();
    expect(p.netProfit).toBeNull();
  });
  it("net profit can be negative when expenses exceed gross", () => {
    const p = composeProfit({ revenue: 5000, cogs: 2000, operatingExpenses: 4000, soldLines: 3, missingCostLines: 0 });
    expect(p.grossProfit).toBe(3000);
    expect(p.netProfit).toBe(-1000);
    expect(p.netMargin).toBeCloseTo(-20);
  });
});

describe("product profitability aggregation", () => {
  const lines = [
    { productId: "a", name: "Pistachio", qty: 2, lineTotal: 600, cogs: 200 },
    { productId: "a", name: "Pistachio", qty: 1, lineTotal: 300, cogs: 100 },
    { productId: "b", name: "Cashew", qty: 5, lineTotal: 500, cogs: 350 },
  ];
  it("groups by product and sums units/revenue/cogs", () => {
    const out = aggregateProductProfit(lines);
    const a = out.find((p) => p.productId === "a")!;
    expect(a.units).toBe(3);
    expect(a.revenue).toBe(900);
    expect(a.cogs).toBe(300);
    expect(a.grossProfit).toBe(600);
    expect(a.margin).toBeCloseTo(66.67, 1);
  });
  it("ranks most profitable first", () => {
    const out = aggregateProductProfit(lines);
    expect(out[0].productId).toBe("a"); // 600 > 150
  });
  it("withholds a product's margin when any of its lines lacks cost", () => {
    const out = aggregateProductProfit([
      { productId: "a", name: "Pistachio", qty: 1, lineTotal: 300, cogs: 100 },
      { productId: "a", name: "Pistachio", qty: 1, lineTotal: 300, cogs: null },
    ]);
    expect(out[0].grossProfit).toBeNull();
    expect(out[0].missingCostLines).toBe(1);
    expect(out[0].revenue).toBe(600); // revenue still exact
  });
  it("buckets unmapped lines without gating other products", () => {
    const out = aggregateProductProfit([
      { productId: null, name: "Unmapped", qty: 1, lineTotal: 100, cogs: null },
    ]);
    expect(out[0].productId).toBe("__unmapped__");
    expect(out[0].grossProfit).toBeNull();
    expect(out[0].revenue).toBe(100);
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
