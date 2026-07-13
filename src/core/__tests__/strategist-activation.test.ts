/** Cycle 8 — activation, reconciliation, daily close, sales catch-up, first
 *  inventory count, count variance, purchase quantities + cash-aware gating,
 *  planned-action amounts, live health, missing-data grouping. All pure. */
import { describe, expect, it } from "vitest";
import { makeSnapshot } from "@/core/strategist/analysis/fixture";
import { metric, missing } from "@/core/strategist/contract";
import { buildActivationChecklist, activationFindings } from "@/core/strategist/analysis/activation";
import { classifyOpeningBaseline, reconcileInterval, classifyDifference } from "@/core/strategist/analysis/reconciliation";
import { composeDailyClose, detectSalesGaps, groupMissingData, liveHealthScore } from "@/core/strategist/analysis/operations";
import { summarizeOpeningStockCount, computeCountVariance } from "@/core/strategist/analysis/inventory-count";
import { buildPurchasePlan } from "@/core/strategist/analysis/purchase-qty";
import { buildObligationCalendar, composeCashState } from "@/core/strategist/analysis/cash";
import { buildStrategyReport } from "@/core/strategist/analysis/report";

const P = "2026-05-01→2026-05-31";
const live = (over = {}) => ({ startDate: null as string | null, confirmedAt: null as string | null, basis: "unset" as const, reason: null, lastCloseDate: null as string | null, ...over });

/* ═══ ACTIVATION ═══ */
describe("activation checklist", () => {
  it("historical-only when nothing live is confirmed; next step is live start", () => {
    const s = makeSnapshot({ cash: { latestCount: missing("t", "all", "/money", "never"), hasLiveData: false }, inventory: { hasLiveData: false }, meta: { liveOps: live() } });
    const c = buildActivationChecklist(s);
    expect(c.readiness).toBe("historical_only");
    expect(c.nextStep!.key).toBe("live_start");
    expect(c.steps.find((x) => x.key === "first_cash")!.unlocks).toContain("verified cash");
  });

  it("live start confirmed but no counts → activation incomplete", () => {
    const s = makeSnapshot({ cash: { latestCount: missing("t", "all", "/money", "never"), hasLiveData: false }, inventory: { hasLiveData: false }, meta: { liveOps: live({ startDate: "2026-07-15", confirmedAt: "2026-07-13", basis: "confirmed" }) } });
    const c = buildActivationChecklist(s);
    expect(c.readiness).toBe("activation_incomplete");
    expect(c.liveStartConfirmed).toBe(true);
    expect(c.nextStep!.key).toBe("first_cash");
  });

  it("all baselines + current + fresh → live_verified", () => {
    const s = makeSnapshot({
      cash: { latestCount: metric(60_000, "t", "2026-05-30", "/money"), countAgeDays: metric(2, "t", "now", "/money"), hasLiveData: true },
      inventory: { hasLiveData: true },
      context: { cashReserveFloor: metric(25_000, "owner answer", P, "/health") },
      meta: { isStale: false, liveOps: live({ startDate: "2026-05-01", confirmedAt: "2026-05-01", basis: "confirmed", lastCloseDate: "2026-05-31" }) },
    });
    const c = buildActivationChecklist(s);
    expect(c.readiness).toBe("live_verified");
    expect(c.requiredRemaining).toBe(0);
    expect(activationFindings(s, c)).toEqual([]); // no nagging once operational
  });

  it("historical gaps do not reduce required steps; unlocked features listed", () => {
    const s = makeSnapshot({ cash: { latestCount: missing("t", "all", "/money", "never"), hasLiveData: false }, meta: { liveOps: live() } });
    const c = buildActivationChecklist(s);
    expect(c.steps.find((x) => x.key === "first_stock")!.unlocks).toContain("purchase quantities");
  });
});

/* ═══ OPENING BASELINE + RECONCILIATION ═══ */
describe("opening baseline", () => {
  it("gap vs ledger is an opening difference, NOT expense/loss/withdrawal", () => {
    const b = classifyOpeningBaseline(45_000, 41_000);
    expect(b.classification).toBe("opening_baseline_difference");
    expect(b.openingDifference).toBe(-4_000);
    expect(b.note).toContain("NOT an expense");
  });
  it("no ledger → baseline with null difference", () => {
    expect(classifyOpeningBaseline(45_000, null).openingDifference).toBeNull();
  });
});

describe("interval reconciliation", () => {
  const inputs = {
    openingDate: "2026-07-15", openingCash: 40_000, closingDate: "2026-07-22", closingCash: 38_000,
    chequeProceedsToCash: 0, ownerInjections: 0, otherAdditions: 0,
    cashExpenses: 2_000, cashPurchases: 0, ownerWithdrawals: 0, corrections: 0, otherReductions: 0,
    hasUnknownPaymentMethod: false,
  };
  it("perfect reconciliation → zero difference", () => {
    const r = reconcileInterval(inputs);
    expect(r.expectedClosing).toBe(38_000);
    expect(r.difference).toBe(0);
    expect(r.confidence).toBe("high");
  });
  it("shortage surfaces as a difference; cheque never counted as cash", () => {
    const r = reconcileInterval({ ...inputs, closingCash: 37_000 });
    expect(r.difference).toBe(-1_000);
    expect(r.note).toContain("NOT counted as drawer cash");
  });
  it("unknown payment method lowers completeness and confidence", () => {
    const r = reconcileInterval({ ...inputs, hasUnknownPaymentMethod: true });
    expect(r.completeness).toBe(70);
    expect(r.confidence).toBe("low");
  });
  it("difference classification is neutral (never theft), shortage → likely missing expense", () => {
    const r = reconcileInterval({ ...inputs, closingCash: 36_500 });
    const cands = classifyDifference(r, { isFirstAfterBaseline: false, hasUnknownPaymentMethod: false });
    expect(cands.some((c) => c.cls === "missing_cash_expense" && c.likelihood === "likely")).toBe(true);
    expect(cands.some((c) => c.cls === "unresolved")).toBe(true);
    expect(JSON.stringify(cands)).not.toMatch(/theft|steal/i);
  });
});

/* ═══ DAILY CLOSE ═══ */
describe("daily close", () => {
  const full = {
    date: "2026-07-20", salesRecorded: true, productLinesRecordedOrMarked: true, expensesConsidered: true,
    purchasesConsidered: true, chequeUpdatedIfRelevant: true, cashCountRecordedIfRequired: true,
    noUnresolvedCashDifference: true, noImportsAwaitingApproval: true, noMissingProductMappings: true,
    requestedStatus: "complete" as const,
  };
  it("complete day → complete, 100% completeness", () => {
    const r = composeDailyClose(full);
    expect(r.status).toBe("complete");
    expect(r.completeness).toBe(100);
  });
  it("missing required sales blocks complete → forced to partial with reason", () => {
    const r = composeDailyClose({ ...full, salesRecorded: false });
    expect(r.status).toBe("partial");
    expect(r.blockedFromComplete).toBe(true);
    expect(r.blockReason).toContain("Nothing is fabricated");
  });
  it("no-trading day → complete without requiring records", () => {
    const r = composeDailyClose({ ...full, salesRecorded: false, requestedStatus: "no_trading" });
    expect(r.status).toBe("no_trading");
    expect(r.completeness).toBe(100);
  });
  it("partial requested with gaps stays partial, lists unresolved", () => {
    const r = composeDailyClose({ ...full, expensesConsidered: false, requestedStatus: "partial" });
    expect(r.status).toBe("partial");
    expect(r.unresolved.length).toBeGreaterThan(0);
  });
});

/* ═══ SALES CATCH-UP ═══ */
describe("sales catch-up gap detection", () => {
  it("detects missing dates, most-recent first, never assumes zero", () => {
    const recorded = new Set(["2026-07-15", "2026-07-17"]);
    const gaps = detectSalesGaps(recorded, new Set(), new Set(), "2026-07-15", "2026-07-18");
    const missingDates = gaps.filter((g) => g.kind === "missing").map((g) => g.date);
    expect(missingDates).toEqual(["2026-07-18", "2026-07-16"]); // recent first
  });
  it("awaiting-import ranks above plain missing; total-only flagged", () => {
    const gaps = detectSalesGaps(new Set(["2026-07-16"]), new Set(["2026-07-16"]), new Set(["2026-07-17"]), "2026-07-15", "2026-07-17");
    expect(gaps[0].kind).toBe("awaiting_import");
    expect(gaps.some((g) => g.kind === "total_only" && g.date === "2026-07-16")).toBe(true);
  });
});

/* ═══ FIRST INVENTORY COUNT ═══ */
describe("opening stock count", () => {
  it("known-cost lines produce value; missing-cost stay value-unknown; NOT a purchase", () => {
    const r = summarizeOpeningStockCount([
      { productId: "1", name: "كاجو", countedQty: 12, unit: "kg", avgCost: 130, hasCost: true },
      { productId: "2", name: "بونبون", countedQty: 40, unit: "kg", avgCost: null, hasCost: false },
      { productId: "3", name: "سوداني", countedQty: null, unit: "kg", avgCost: 45, hasCost: true },
    ]);
    expect(r.counted).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.knownStockValue).toBe(12 * 130);
    expect(r.unknownValueProducts).toContain("بونبون");
    expect(r.note).toContain("NOT a purchase or sale");
  });
  it("missing unit is surfaced", () => {
    const r = summarizeOpeningStockCount([{ productId: "1", name: "X", countedQty: 5, unit: null, avgCost: 10, hasCost: true }]);
    expect(r.missingUnits).toContain("X");
  });
});

describe("count variance", () => {
  it("unit mismatch blocks the computation", () => {
    const v = computeCountVariance({ productId: "1", name: "كاجو", expectedQty: 10, countedQty: 8, expectedUnit: "kg", countedUnit: "piece", avgCost: 130 });
    expect(v.blocked).toBe(true);
    expect(v.candidates).toContain("unit_mismatch");
  });
  it("shortage → sale-unrecorded/waste candidates, never theft; value impact from cost", () => {
    const v = computeCountVariance({ productId: "1", name: "كاجو", expectedQty: 10, countedQty: 8, expectedUnit: "kg", countedUnit: "kg", avgCost: 130 });
    expect(v.variance).toBe(-2);
    expect(v.valueImpact).toBe(-260);
    expect(v.candidates).toContain("sale_unrecorded");
    expect(v.note).toContain("NOT assumed to be theft"); // explicit neutral framing
    expect(v.candidates).not.toContain("theft" as never);
  });
  it("no prior expected → this count sets the baseline", () => {
    const v = computeCountVariance({ productId: "1", name: "X", expectedQty: null, countedQty: 5, expectedUnit: "kg", countedUnit: "kg", avgCost: 10 });
    expect(v.note).toContain("sets its baseline");
  });
});

/* ═══ PURCHASE QUANTITY + CASH-AWARE ═══ */
describe("purchase quantity engine", () => {
  const withStock = (onHand: number, extraCash = 100_000) => {
    const s = makeSnapshot({
      cash: { latestCount: metric(extraCash, "t", "2026-05-30", "/money"), countAgeDays: metric(2, "t", "now", "/money"), hasLiveData: true },
      inventory: { hasLiveData: true },
      products: {
        positions: metric([{ name: "كاجو", sellingPrice: 260, avgCost: 130, hasCost: true, onHand, isLow: onHand < 10, vendor: "Nut Man" }], "t", "now", "/stock"),
      },
    });
    return s;
  };

  it("reliable stock + velocity → buy quantity covering lead + tolerance", () => {
    const s = withStock(10); // كاجو fixture: 90 units / 31 days ≈ 2.9/day, cover ≈ 3.4 days < 7
    const plan = buildPurchasePlan(s, composeCashState(s, buildObligationCalendar(s)));
    const kaju = plan.recommendations.find((r) => r.name === "كاجو")!;
    expect(["buy_now", "buy_soon"]).toContain(kaju.verdict);
    expect(kaju.recommendedQty).toBeGreaterThan(0);
    expect(kaju.estimatedCost).toBeGreaterThan(0);
    expect(kaju.leadTimeAssumed).toBe(true);
  });

  it("untracked inventory → count_first, never a quantity", () => {
    const s = makeSnapshot();
    s.inventory.hasLiveData = false;
    const plan = buildPurchasePlan(s, composeCashState(s, buildObligationCalendar(s)));
    expect(plan.recommendations.every((r) => r.verdict === "count_first" && r.recommendedQty == null)).toBe(true);
  });

  it("needed but unaffordable → combined verdict respects cash safety", () => {
    const s = withStock(10, 20_000); // low cash, restock needed
    const plan = buildPurchasePlan(s, composeCashState(s, buildObligationCalendar(s)));
    const kaju = plan.recommendations.find((r) => r.name === "كاجو")!;
    expect(["unsafe", "needed_but_cash_constrained", "wait_for_cheque"]).toContain(kaju.combined);
  });

  it("excess stock on a slow-relative product → do_not_buy", () => {
    const s = withStock(500); // huge stock, ~2.9/day → ~170 days cover
    const plan = buildPurchasePlan(s, composeCashState(s, buildObligationCalendar(s)));
    const kaju = plan.recommendations.find((r) => r.name === "كاجو")!;
    expect(kaju.verdict).toBe("do_not_buy");
  });

  it("low coverage refuses the whole plan with a reason", () => {
    const s = makeSnapshot({ products: { detail: metric([], "t", P, "/reports", { completeness: 20 }) } });
    const plan = buildPurchasePlan(s, composeCashState(s, buildObligationCalendar(s)));
    expect(plan.available).toBe(false);
  });
});

/* ═══ PLANNED ACTION AMOUNTS → OBLIGATIONS ═══ */
describe("planned action amounts", () => {
  it("accepted financial commitment enters the obligation calendar", () => {
    const s = makeSnapshot();
    const cal = buildObligationCalendar(s, [{ title: "Planned withdrawal", amount: 15_000, dueDate: "2026-06-10" }]);
    expect(cal.items.some((o) => o.name === "Planned withdrawal" && o.basis === "accepted_action")).toBe(true);
    expect(cal.next30).toBeGreaterThanOrEqual(15_000);
  });
  it("a suggested action with no amount does NOT enter obligations", () => {
    const cal = buildObligationCalendar(makeSnapshot(), []);
    expect(cal.items.every((o) => o.name !== "Planned withdrawal")).toBe(true);
  });
});

/* ═══ LIVE HEALTH + MISSING DATA ═══ */
describe("live health score", () => {
  it("historical gaps don't destroy the live score; readiness reflected", () => {
    const s = makeSnapshot({
      meta: { completenessScore: 40, isStale: false, liveOps: live({ startDate: "2026-05-01", confirmedAt: "2026-05-01", basis: "confirmed" }) },
      cash: { latestCount: metric(60_000, "t", "2026-05-30", "/money"), countAgeDays: metric(2, "t", "now", "/money"), hasLiveData: true },
      inventory: { hasLiveData: true },
    });
    const h = liveHealthScore(s, buildActivationChecklist(s));
    expect(h.historicalCompleteness).toBe(40);
    expect(h.liveCompleteness).toBe(100);    // all live baselines present
    expect(h.cashConfidence).toBe("high");
    expect(h.inventoryConfidence).toBe("medium");
  });
  it("no counts → confidences none, improvements listed", () => {
    const s = makeSnapshot({ cash: { latestCount: missing("t", "all", "/money", "never"), hasLiveData: false }, inventory: { hasLiveData: false }, meta: { liveOps: live() } });
    const h = liveHealthScore(s, buildActivationChecklist(s));
    expect(h.cashConfidence).toBe("none");
    expect(h.inventoryConfidence).toBe("none");
    expect(h.wouldImprove).toContain("record the first drawer count");
  });
});

describe("missing-data grouping", () => {
  it("Activate BostaOS outranks historical cleanup; every item has an action", () => {
    const s = makeSnapshot({
      cash: { latestCount: missing("t", "all", "/money", "never"), hasLiveData: false }, meta: { liveOps: live() },
      profit: { uncoveredRevenue: metric(50_000, "t", P, "/reconcile") },
    });
    const groups = groupMissingData(s, buildActivationChecklist(s));
    expect(groups[0].group).toBe("Activate BostaOS");
    const hist = groups.find((g) => g.group === "Historical cleanup");
    if (hist) expect(hist.rank).toBeGreaterThan(groups[0].rank);
    expect(groups.every((g) => g.items.every((i) => i.action.length > 0))).toBe(true);
  });
});

/* ═══ STRATEGIST ACTIVATION REASONING (integrated) ═══ */
describe("strategist activation reasoning", () => {
  it("report surfaces activation + a weekly activation priority while foundations missing", () => {
    const s = makeSnapshot({ cash: { latestCount: missing("t", "all", "/money", "never"), hasLiveData: false }, inventory: { hasLiveData: false }, meta: { liveOps: live() } });
    const report = buildStrategyReport(s);
    expect(report.activation.readiness).toBe("historical_only");
    expect(report.findings.some((f) => f.id.startsWith("activate-"))).toBe(true);
    expect(report.liveHealth.operationalReadiness).toBe("historical_only");
  });
});
