import { describe, it, expect } from "vitest";
import { CAP, isEnabled, cap } from "@/core/capabilities";
import { reconTolerance } from "@/core/read/sales";
import { toIso, toNum, parseSalesRows, parseExpenseRows, scanReceiptText, scanReceiptRows } from "@/core/import/csv";
import { composeProfit } from "@/core/read/profit";
import { aggregateProductProfit } from "@/core/read/products";
import { mergeActivity, type ActivityEvent } from "@/core/read/activity";
import {
  buildStockInsights, buildCashInsights, buildSettlementInsights, buildTrendInsights,
  sortInsights, type StockPositionLite, type Velocity,
} from "@/core/insights/risk";
import { reconTolerance as recon } from "@/core/read/sales";
import { signMoney, affectsProfit, type MoneyType } from "@/core/money/sign";
import { composeHealth } from "@/core/read/health";
import { todayCairo, monthBoundsCairo, lastMonthBoundsCairo, isoDaysAgo, isoRange, priorRange } from "@/core/time";
import { explainError, errorMessage, rawMessage } from "@/core/db/errors";
import { aggregateExpenseCategories } from "@/core/read/expenses";
import { QA_FLOWS, QA_GROUPS } from "@/features/qa/checklist";
import { resolveRange, rangeLabel as rangeLabelFn } from "@/core/range";

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

describe("receipt OCR text scanning (best-guess date + total)", () => {
  it("picks the date and the total-labelled amount", () => {
    const text = "Bosta Bites\nDate: 12/06/2026\nItems 320.00\nVAT 44.80\nTOTAL  4,200.50\nThank you";
    expect(scanReceiptText(text)).toEqual({ date: "2026-06-12", total: 4200.5 });
  });
  it("falls back to the largest number when no total label", () => {
    const text = "2026-06-01\n120\n980\n55";
    expect(scanReceiptText(text)).toEqual({ date: "2026-06-01", total: 980 });
  });
  it("returns nulls on unreadable text without inventing data", () => {
    expect(scanReceiptText("no useful content here")).toEqual({ date: null, total: null });
    expect(scanReceiptText("")).toEqual({ date: null, total: null });
  });
  it("reads MANY day rows from a multi-day sales sheet", () => {
    const sheet = "Daily sales\n01/06/2026  1,200\n02/06/2026  980.50\n03/06/2026  2050\nTotal 4230";
    expect(scanReceiptRows(sheet)).toEqual([
      { date: "2026-06-01", amount: 1200 },
      { date: "2026-06-02", amount: 980.5 },
      { date: "2026-06-03", amount: 2050 },
    ]);
  });
  it("falls back to a single best-guess row when no dated lines", () => {
    expect(scanReceiptRows("TOTAL 500\n2026-06-09")).toEqual([{ date: "2026-06-09", amount: 500 }]);
    expect(scanReceiptRows("garbage")).toEqual([]);
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

describe("activity feed merge", () => {
  const e = (id: string, date: string, ts: string, kind: ActivityEvent["kind"] = "sale"): ActivityEvent =>
    ({ id, kind, date, ts, label: id, amount: 0, route: "/" });
  it("orders newest day first, then newest timestamp within a day", () => {
    const out = mergeActivity([
      e("a", "2026-06-01", "2026-06-01T08:00:00Z"),
      e("b", "2026-06-03", "2026-06-03T09:00:00Z"),
      e("c", "2026-06-03", "2026-06-03T12:00:00Z"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
  it("respects the limit", () => {
    const xs = Array.from({ length: 50 }, (_, i) => e(`e${i}`, "2026-06-01", `2026-06-01T00:00:${String(i).padStart(2, "0")}Z`));
    expect(mergeActivity(xs, 10)).toHaveLength(10);
  });
});

describe("stock risk insights", () => {
  const pos = (over: Partial<StockPositionLite>): StockPositionLite =>
    ({ id: "p", nameEn: "Pistachio", baseUnit: "g", onHand: 1000, isNegative: false, isLow: false, hasCost: true, active: true, ...over });
  const noVel = new Map<string, Velocity>();
  it("flags negative stock as critical with a purchase fix", () => {
    const [i] = buildStockInsights([pos({ onHand: -50, isNegative: true })], noVel);
    expect(i.severity).toBe("critical");
    expect(i.route).toBe("/purchases");
  });
  it("flags out-of-stock when on-hand is zero", () => {
    const [i] = buildStockInsights([pos({ onHand: 0 })], noVel);
    expect(i.severity).toBe("warning");
    expect(i.title).toMatch(/out of stock/);
  });
  it("projects days-of-cover only with enough history (estimate)", () => {
    const vel = new Map([["p", { unitsPerDay: 200, daysObserved: 14 }]]); // 1000/200 = 5 days < 7
    const [i] = buildStockInsights([pos({ onHand: 1000 })], vel);
    expect(i.confidence).toBe("estimate");
    expect(i.title).toMatch(/day.* of stock left/);
  });
  it("does NOT project cover from thin history (avoids fake confidence)", () => {
    const vel = new Map([["p", { unitsPerDay: 200, daysObserved: 3 }]]);
    expect(buildStockInsights([pos({ onHand: 1000 })], vel)).toHaveLength(0);
  });
  it("ignores inactive products", () => {
    expect(buildStockInsights([pos({ onHand: -1, isNegative: true, active: false })], noVel)).toHaveLength(0);
  });
});

describe("cash risk insights", () => {
  it("flags a negative balance as critical", () => {
    const [i] = buildCashInsights({ balance: -500, inflow: 0, outflow: 0, withdrawals: 0, hasEverCounted: true });
    expect(i.severity).toBe("critical");
  });
  it("warns when withdrawals exceed inflow", () => {
    const xs = buildCashInsights({ balance: 100, inflow: 1000, outflow: -200, withdrawals: 1500, hasEverCounted: true });
    expect(xs.find((i) => i.key === "cash-withdrawals")?.severity).toBe("warning");
  });
  it("notes never-counted cash as low-data, not a hard warning", () => {
    const xs = buildCashInsights({ balance: 100, inflow: 100, outflow: 0, withdrawals: 0, hasEverCounted: false });
    expect(xs.find((i) => i.key === "cash-uncounted")?.confidence).toBe("low-data");
  });
});

describe("settlement intelligence", () => {
  it("flags expected money with no cheque recorded", () => {
    const xs = buildSettlementInsights(
      [{ id: "per1", start: "2026-06-01", netExpected: 5000, status: "open", hasCheque: false }], [], recon);
    expect(xs[0].title).toMatch(/no cheque recorded/);
  });
  it("flags a cheque shortfall beyond tolerance", () => {
    const xs = buildSettlementInsights([], [{ id: "c1", expected: 10000, received: 9000, difference: -1000, status: "received" }], recon);
    expect(xs[0].title).toMatch(/under expected/);
    expect(xs[0].metric).toMatch(/−/);
  });
  it("stays silent when a cheque matches within tolerance", () => {
    const xs = buildSettlementInsights([], [{ id: "c1", expected: 10000, received: 9990, difference: -10, status: "received" }], recon);
    expect(xs).toHaveLength(0); // tolerance = max(5, 0.5% of 10000)=50
  });
});

describe("trend analysis (honest about thin history)", () => {
  it("computes a month-over-month revenue change", () => {
    const xs = buildTrendInsights({ thisRevenue: 12000, lastRevenue: 10000, thisExpenses: 0, lastExpenses: 0 });
    expect(xs[0].title).toMatch(/up 20%/);
    expect(xs[0].confidence).toBe("high");
  });
  it("refuses to invent a trend with no prior month", () => {
    const xs = buildTrendInsights({ thisRevenue: 12000, lastRevenue: 0, thisExpenses: 0, lastExpenses: 0 });
    expect(xs[0].confidence).toBe("low-data");
  });
});

describe("insight sorting", () => {
  it("orders critical before warning before info", () => {
    const order = sortInsights([
      { key: "i", severity: "info", title: "", detail: "", action: "", route: "/", confidence: "high" },
      { key: "c", severity: "critical", title: "", detail: "", action: "", route: "/", confidence: "high" },
      { key: "w", severity: "warning", title: "", detail: "", action: "", route: "/", confidence: "high" },
    ]).map((x) => x.key);
    expect(order).toEqual(["c", "w", "i"]);
  });
});

describe("cash sign logic", () => {
  it("inflow types are positive", () => {
    expect(signMoney("cheque_inflow", 100)).toBe(100);
    expect(signMoney("owner_injection", 100)).toBe(100);
  });
  it("outflow types are negative", () => {
    expect(signMoney("personal_withdrawal", 100)).toBe(-100);
    expect(signMoney("cash_expense", 100)).toBe(-100);
    expect(signMoney("salary", 100)).toBe(-100);
  });
  it("magnitude sign is ignored — classification decides direction", () => {
    expect(signMoney("personal_withdrawal", -100)).toBe(-100);
    expect(signMoney("cheque_inflow", -100)).toBe(100);
  });
  it("adjustment respects the caller's direction (defaults to in)", () => {
    expect(signMoney("adjustment", 50, "out")).toBe(-50);
    expect(signMoney("adjustment", 50, "in")).toBe(50);
    expect(signMoney("adjustment", 50)).toBe(50);
  });
});

describe("withdrawals (and all cash movements) never affect profit", () => {
  const all: MoneyType[] = ["cheque_inflow", "owner_injection", "personal_withdrawal", "cash_expense", "salary", "adjustment"];
  it("no money-movement type is counted in P&L", () => {
    for (const t of all) expect(affectsProfit(t)).toBe(false);
  });
  it("a withdrawal is negative cash but profit-neutral", () => {
    expect(signMoney("personal_withdrawal", 500)).toBe(-500);
    expect(affectsProfit("personal_withdrawal")).toBe(false);
  });
});

describe("time / date helpers (Africa/Cairo)", () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`); // midday UTC → same Cairo date
  it("todayCairo returns the Cairo calendar date", () => {
    expect(todayCairo(at("2026-06-22"))).toBe("2026-06-22");
  });
  it("monthBoundsCairo spans the full month", () => {
    expect(monthBoundsCairo(at("2026-06-15"))).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(monthBoundsCairo(at("2026-02-10"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("lastMonthBoundsCairo handles year rollover", () => {
    expect(lastMonthBoundsCairo(at("2026-06-15"))).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    expect(lastMonthBoundsCairo(at("2026-01-09"))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
  it("isoDaysAgo subtracts calendar days across month boundaries", () => {
    expect(isoDaysAgo("2026-06-22", 29)).toBe("2026-05-24");
    expect(isoDaysAgo("2026-03-01", 1)).toBe("2026-02-28");
  });
  it("isoRange is inclusive on both ends", () => {
    expect(isoRange("2026-06-01", "2026-06-03")).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(isoRange("2026-06-05", "2026-06-05")).toEqual(["2026-06-05"]);
  });
});

describe("health score composition (real or null, never faked)", () => {
  const base = {
    monthRev: 12000, lastRev: 10000,
    profit: { complete: true, margin: 45, missingCostLines: 0 },
    stock: { activeCount: 4, costedCount: 4, costedNonNegCount: 4 },
    issuesCount: 0, streakDays: 5, cash: { score: 90, errPct: 1 },
  };
  it("scores overall when categories have data", () => {
    const h = composeHealth(base);
    expect(h.overall).not.toBeNull();
    expect(h.categories.find((c) => c.key === "revenue")!.trend).toBe(20);
    expect(h.level).toBeGreaterThanOrEqual(1);
  });
  it("withholds the profit category when COGS is incomplete", () => {
    const h = composeHealth({ ...base, profit: { complete: false, margin: null, missingCostLines: 2 } });
    expect(h.categories.find((c) => c.key === "profit")!.score).toBeNull();
  });
  it("returns null overall when only data-quality has a score (new shop)", () => {
    const h = composeHealth({
      monthRev: 0, lastRev: 0,
      profit: { complete: false, margin: null, missingCostLines: 0 },
      stock: { activeCount: 0, costedCount: 0, costedNonNegCount: 0 },
      issuesCount: 1, streakDays: 0, cash: { score: null, errPct: 0 },
    });
    expect(h.overall).toBeNull();
    expect(h.status).toBe("Not enough data yet");
  });
});

describe("friendly error mapping (never swallows the raw DB message)", () => {
  it("reads message from a PostgrestError-shaped plain object (not an Error)", () => {
    const pg = { message: 'new row violates row-level security policy for table "products"', code: "42501" };
    expect(rawMessage(pg)).toContain("row-level security");
    expect(explainError(pg).title).toMatch(/Permission denied/);
    expect(errorMessage(pg)).toContain("42501"); // raw code preserved for screenshots
  });
  it("maps unique violations to 'already exists'", () => {
    expect(explainError({ code: "23505", message: "duplicate key value" }).title).toMatch(/already exists/);
  });
  it("maps missing RPC / schema drift", () => {
    expect(explainError({ message: "Could not find the function create_purchase" }).title).toMatch(/backend function is missing/);
  });
  it("maps expired session", () => {
    expect(explainError({ message: "JWT expired" }).title).toMatch(/session expired/i);
  });
  it("maps network failure", () => {
    expect(explainError({ message: "Failed to fetch" }).title).toMatch(/Couldn't reach the server/);
  });
  it("falls back to the raw message instead of a generic 'Save failed'", () => {
    expect(explainError({ message: "something specific went wrong" }).title).toBe("something specific went wrong");
    expect(errorMessage("plain string error")).toBe("plain string error");
  });
});

describe("expense category aggregation + trend", () => {
  const cur = [
    { category: "Rent", amount: 15000 },
    { category: "Supplies", amount: 3000 },
    { category: "Supplies", amount: 2000 },
  ];
  const prior = [{ category: "Rent", amount: 15000 }, { category: "Supplies", amount: 4000 }];
  it("sums by category and ranks by amount", () => {
    const out = aggregateExpenseCategories(cur, prior);
    expect(out[0]).toMatchObject({ category: "Rent", amount: 15000 });
    expect(out.find((c) => c.category === "Supplies")!.amount).toBe(5000);
  });
  it("computes share of current total", () => {
    const out = aggregateExpenseCategories(cur, prior);
    expect(out.find((c) => c.category === "Rent")!.sharePct).toBeCloseTo(75); // 15000/20000
  });
  it("computes change vs prior, withholding when prior is zero", () => {
    const out = aggregateExpenseCategories(cur, prior);
    expect(out.find((c) => c.category === "Supplies")!.changePct).toBeCloseTo(25); // 5000 vs 4000
    const novel = aggregateExpenseCategories([{ category: "Marketing", amount: 500 }], []);
    expect(novel[0].changePct).toBeNull(); // no fake %
  });
});

describe("priorRange = equal-length window immediately before", () => {
  it("mirrors a month-length range", () => {
    expect(priorRange({ from: "2026-06-01", to: "2026-06-30" })).toEqual({ from: "2026-05-02", to: "2026-05-31" });
  });
  it("handles a single day", () => {
    expect(priorRange({ from: "2026-06-10", to: "2026-06-10" })).toEqual({ from: "2026-06-09", to: "2026-06-09" });
  });
});

describe("QA checklist catalogue", () => {
  it("has unique flow ids", () => {
    expect(new Set(QA_FLOWS.map((f) => f.id)).size).toBe(QA_FLOWS.length);
  });
  it("every flow names a screen, action, expected result and table/RPC", () => {
    for (const f of QA_FLOWS) {
      expect(f.screen.length).toBeGreaterThan(0);
      expect(f.action.length).toBeGreaterThan(0);
      expect(f.expected.length).toBeGreaterThan(0);
      expect(f.touches.length).toBeGreaterThan(0);
    }
  });
  it("covers every write group", () => {
    for (const g of ["Goods", "Purchases", "Sales", "Expenses", "Cash", "Cheques", "Imports", "Settings"]) {
      expect(QA_GROUPS).toContain(g);
    }
  });
});

describe("date-range engine (pinned today)", () => {
  const T = "2026-06-15";
  it("resolves rolling windows", () => {
    expect(resolveRange("today", undefined, T)).toEqual({ from: "2026-06-15", to: "2026-06-15" });
    expect(resolveRange("7d", undefined, T)).toEqual({ from: "2026-06-09", to: "2026-06-15" });
    expect(resolveRange("30d", undefined, T)).toEqual({ from: "2026-05-17", to: "2026-06-15" });
  });
  it("resolves calendar windows incl. Feb + quarter + year", () => {
    expect(resolveRange("month", undefined, T)).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(resolveRange("month", undefined, "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolveRange("last", undefined, T)).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    expect(resolveRange("quarter", undefined, T)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(resolveRange("year", undefined, T)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
  it("handles January rollover for last-month and Q1", () => {
    expect(resolveRange("last", undefined, "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolveRange("quarter", undefined, "2026-01-10")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });
  it("custom tolerates reversed inputs and labels itself", () => {
    expect(resolveRange("custom", { from: "2026-06-20", to: "2026-06-10" }, T)).toEqual({ from: "2026-06-10", to: "2026-06-20" });
    expect(rangeLabelFn("custom", { from: "2026-06-10", to: "2026-06-20" })).toBe("2026-06-10 → 2026-06-20");
    expect(rangeLabelFn("month", resolveRange("month", undefined, T))).toBe("This month");
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
