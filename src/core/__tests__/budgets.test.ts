import { describe, it, expect } from "vitest";
import { computeBudgetRow, composeBudgets, normalizeTargets, EMPTY_TARGETS } from "@/core/budgets/logic";

describe("normalizeTargets", () => {
  it("keeps positive numbers, drops junk, defaults empty", () => {
    expect(normalizeTargets(null)).toEqual(EMPTY_TARGETS);
    const t = normalizeTargets({ monthlyRevenue: "120000", monthlyProfit: 0, monthlyExpenseBudget: -5, categoryBudgets: { Rent: 15000, Bad: "x" } });
    expect(t.monthlyRevenue).toBe(120000);
    expect(t.monthlyProfit).toBeNull(); // 0 is not a valid (>0) target
    expect(t.monthlyExpenseBudget).toBeNull();
    expect(t.categoryBudgets).toEqual({ Rent: 15000 });
  });
});

describe("computeBudgetRow — revenue/profit (higher is better)", () => {
  it("ahead when actual ≥ target", () => {
    const r = computeBudgetRow("revenue", "Revenue", "revenue", 100, 100, 0.5);
    expect(r.status).toBe("ahead");
    expect(r.progressPct).toBe(100);
  });
  it("on-track when progress keeps up with pace", () => {
    const r = computeBudgetRow("revenue", "Revenue", "revenue", 100, 50, 0.5);
    expect(r.status).toBe("on-track");
  });
  it("behind when progress lags pace", () => {
    const r = computeBudgetRow("revenue", "Revenue", "revenue", 100, 20, 0.8);
    expect(r.status).toBe("behind");
  });
  it("unknown when actual is null (e.g. profit with missing COGS)", () => {
    const r = computeBudgetRow("profit", "Profit", "profit", 100, null, 0.5);
    expect(r.status).toBe("unknown");
    expect(r.progressPct).toBe(0);
  });
});

describe("computeBudgetRow — expense (lower is better)", () => {
  it("over when actual exceeds budget", () => {
    expect(computeBudgetRow("expense", "Exp", "expense", 100, 120, 0.5).status).toBe("over");
  });
  it("behind/overspending when ahead of pace but under cap", () => {
    expect(computeBudgetRow("expense", "Exp", "expense", 100, 80, 0.3).status).toBe("behind");
  });
  it("on-track when within pace", () => {
    expect(computeBudgetRow("expense", "Exp", "expense", 100, 40, 0.5).status).toBe("on-track");
  });
});

describe("composeBudgets", () => {
  it("only emits rows for configured targets and raises off-track alerts", () => {
    const { rows, alerts } = composeBudgets(
      { monthlyRevenue: 100, monthlyProfit: null, monthlyExpenseBudget: 100, categoryBudgets: { Rent: 50 } },
      { revenue: 20, netProfit: null, operatingExpenses: 130, categorySpend: { Rent: 60 } },
      0.9,
    );
    expect(rows.map((r) => r.key).sort()).toEqual(["cat:Rent", "expense", "revenue"]);
    // expense over budget + category over budget + revenue behind
    expect(alerts.some((a) => a.key === "budget-over-expense")).toBe(true);
    expect(alerts.some((a) => a.key === "budget-over-cat:Rent")).toBe(true);
    expect(alerts.some((a) => a.key === "budget-behind-revenue")).toBe(true);
  });
  it("emits nothing when no targets set", () => {
    const { rows, alerts } = composeBudgets({ monthlyRevenue: null, monthlyProfit: null, monthlyExpenseBudget: null, categoryBudgets: {} }, { revenue: 999, netProfit: 1, operatingExpenses: 1, categorySpend: {} }, 0.5);
    expect(rows).toEqual([]);
    expect(alerts).toEqual([]);
  });
});
