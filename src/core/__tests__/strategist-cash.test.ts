/** Cycle 7 — cash intelligence: CashState, obligations, withdrawal v2,
 *  affordability, projection, runway, cash priorities. Pure, deterministic. */
import { describe, expect, it } from "vitest";
import { makeSnapshot } from "@/core/strategist/analysis/fixture";
import { metric, missing } from "@/core/strategist/contract";
import { buildObligationCalendar, composeCashState, computeReserve } from "@/core/strategist/analysis/cash";
import { assessAffordability, assessWithdrawalV2 } from "@/core/strategist/analysis/affordability";
import { projectCash, computeRunway } from "@/core/strategist/analysis/forecast-cash";
import { buildStrategyReport } from "@/core/strategist/analysis/report";
import { selectWeeklyPriority } from "@/core/strategist/analysis/priority";

const P = "2026-05-01→2026-05-31";

/** production-like: profitable, cheque-settled, NEVER counted the drawer */
const uncounted = () => makeSnapshot({
  cash: {
    hasLiveData: false,
    latestCount: missing("cash_reconciliations", "all-time", "/money", "never counted"),
    lastCountDate: missing("cash_reconciliations", "all-time", "/money", "never counted"),
    countAgeDays: missing("cash_reconciliations", "all-time", "/money", "never counted"),
    expectedBalance: metric(41_000, "read/money.getCashPosition", "now", "/money", { basis: "calculated", note: "opening anchor 2026-07-01" }),
    withdrawals: metric(0, "read/money.getCashSummary", P, "/money"),
  },
});
/** verified: fresh drawer count exists */
const counted = (amount = 60_000, ageDays = 2) => makeSnapshot({
  cash: {
    latestCount: metric(amount, "cash_reconciliations (latest)", "2026-05-29", "/money"),
    lastCountDate: metric("2026-05-29", "cash_reconciliations", "latest", "/money"),
    countAgeDays: metric(ageDays, "cash_reconciliations", "latest", "/money", { basis: "calculated" }),
    expectedBalance: metric(62_000, "read/money.getCashPosition", "now", "/money", { basis: "calculated" }),
    hasLiveData: true,
  },
  meta: { isStale: false, staleDays: 2 },
});

describe("obligation calendar", () => {
  it("derives recurring cash costs, EXCLUDES rent (cheque-deducted), windows totals", () => {
    const s = makeSnapshot();
    const cal = buildObligationCalendar(s);
    expect(cal.items.some((o) => /salary/i.test(o.name))).toBe(true);
    expect(cal.items.some((o) => /rent/i.test(o.name))).toBe(false);
    expect(cal.chequeDeductionsNote).toContain("deducted from the settlement cheque");
    expect(cal.next30).toBeGreaterThan(cal.next7);
  });

  it("accepted owner commitments join the calendar with real dates", () => {
    const cal = buildObligationCalendar(makeSnapshot(), [{ title: "Freezer repair", amount: 3_000, dueDate: "2026-06-05" }]);
    const rep = cal.items.find((o) => o.name === "Freezer repair")!;
    expect(rep.basis).toBe("accepted_action");
    expect(rep.due.date).toBe("2026-06-05");
  });
});

describe("cash state", () => {
  it("never counted → verified null (never zero), unknowable verdict, count blocker", () => {
    const s = uncounted();
    const cash = composeCashState(s, buildObligationCalendar(s));
    expect(cash.available.verifiedCash).toBeNull();
    expect(cash.available.totalVerified).toBeNull();
    expect(cash.safety.verdict).toBe("unknowable");
    expect(cash.safety.blockers[0]).toContain("first drawer count");
    expect(cash.expected.ledgerExpected).toBe(41_000); // expected ≠ verified, kept separate
    expect(cash.uncertain.join(" ")).toContain("payment methods are untracked");
  });

  it("fresh count → verified headroom = count − committed30 − reserve", () => {
    const s = counted();
    const cal = buildObligationCalendar(s);
    const cash = composeCashState(s, cal);
    expect(cash.available.verifiedCash).toBe(60_000);
    expect(cash.safety.verifiedHeadroom).toBe(60_000 - cal.next30 - cash.safety.requiredReserve);
    expect(["comfortable", "adequate", "tight"]).toContain(cash.safety.verdict);
  });

  it("stale count → verified withheld with the age named", () => {
    const s = counted(60_000, 12); // freshness limit default 7
    const cash = composeCashState(s, buildObligationCalendar(s));
    expect(cash.available.verifiedCash).toBeNull();
    expect(cash.available.countIsStale).toBe(true);
    expect(cash.available.note).toContain("stale");
  });

  it("reserve honors the higher-of-both policy", () => {
    const s = makeSnapshot();
    const r = computeReserve(s);
    // fixed floor 25k vs ~30d opex (salary 5,700 + fixture opex fallback) → floor wins here
    expect(r.amount).toBeGreaterThanOrEqual(25_000);
    expect(r.basis).toContain("higher of");
  });

  it("expected cheque money is never counted as available", () => {
    const s = counted();
    const cash = composeCashState(s, buildObligationCalendar(s));
    expect(cash.expected.openSettlementNet).toBe(78_000);
    expect(cash.available.totalVerified).toBe(60_000); // untouched by the cheque
    expect(cash.expected.clearingNote).toContain("NOT available");
  });
});

describe("withdrawal v2", () => {
  it("never counted → unknowable, count-first next step, no fake maximum", () => {
    const s = uncounted();
    const w = assessWithdrawalV2(s, composeCashState(s, buildObligationCalendar(s)), 20_000);
    expect(w.verdict).toBe("unknowable");
    expect(w.answerLevel).toBe("unknowable");
    expect(w.recommendedMax).toBeNull();
    expect(w.nextStep).toContain("first drawer count");
    expect(w.verifiedHeadroom).toContain("unknowable");
  });

  it("profitable but illiquid → cash refuses what profit would allow", () => {
    const s = counted(20_000); // verified 20k, profit 27k
    const cash = composeCashState(s, buildObligationCalendar(s));
    const w = assessWithdrawalV2(s, cash, 20_000);
    expect(["unsafe", "tight", "conditional"]).toContain(w.verdict);
    expect(w.profitContext).toContain("liquidity decides");
  });

  it("weak profit but high verified cash → cash can allow it, profit is context", () => {
    const s = counted(150_000);
    s.profit.netProfit = metric(2_000, "read/profit.getProfitReadout", P, "/reconcile");
    const w = assessWithdrawalV2(s, composeCashState(s, buildObligationCalendar(s)), 20_000);
    expect(["safe", "safe_reduces_flexibility"]).toContain(w.verdict);
  });

  it("withdrawal breaching the reserve → unsafe with the breach quantified", () => {
    const s = counted(60_000);
    const cash = composeCashState(s, buildObligationCalendar(s));
    const w = assessWithdrawalV2(s, cash, 55_000);
    expect(w.verdict === "unsafe" || w.verdict === "conditional").toBe(true);
    expect(w.resultingReserve).toMatch(/breach|remain/);
  });

  it("prior withdrawals are shown against profit", () => {
    const s = counted();
    s.cash.withdrawals = metric(10_000, "read/money.getCashSummary", P, "/money");
    const w = assessWithdrawalV2(s, composeCashState(s, buildObligationCalendar(s)), 5_000);
    expect(w.withdrawalsAlready).toContain("EGP 10,000");
    expect(w.reasonsToWait.join(" ")).toContain("already withdrawn");
  });
});

describe("affordability", () => {
  it("one-time purchase within headroom → safe; oversized → unsafe", () => {
    const s = counted(100_000);
    const cash = composeCashState(s, buildObligationCalendar(s));
    expect(assessAffordability(s, cash, { kind: "purchase", upfront: 10_000, mandatory: false }).verdict).toMatch(/safe/);
    expect(assessAffordability(s, cash, { kind: "purchase", upfront: 95_000, mandatory: false }).verdict).toBe("unsafe");
  });

  it("employee hire: revenue-to-cover at measured margin, NO revenue benefit assumed", () => {
    const s = counted(100_000);
    const cash = composeCashState(s, buildObligationCalendar(s));
    const a = assessAffordability(s, cash, { kind: "employee", upfront: 0, recurringMonthly: 6_000, mandatory: false });
    expect(a.recurring).not.toBeNull();
    expect(a.recurring!.revenueToCover).toBe(Math.round(6_000 / 0.4)); // 40% fixture margin
    expect(a.assumptions.join(" ")).toContain("no revenue benefit is assumed");
    expect(a.recurring!.sustainable).toBe(true); // net profit 27k ≥ 6k
  });

  it("unsustainable recurring cost degrades the verdict with the reason", () => {
    const s = counted(100_000);
    s.profit.netProfit = metric(3_000, "read/profit.getProfitReadout", P, "/reconcile");
    const a = assessAffordability(s, composeCashState(s, buildObligationCalendar(s)), { kind: "recurring_expense", upfront: 0, recurringMonthly: 8_000 });
    expect(a.recurring!.sustainable).toBe(false);
    expect(a.reasons.join(" ")).toContain("does not cover");
  });

  it("optional spend with no count → unknowable unless Tune allows expected-cash", () => {
    const s = uncounted();
    const cash = composeCashState(s, buildObligationCalendar(s));
    expect(assessAffordability(s, cash, { kind: "purchase", upfront: 10_000, mandatory: false }).verdict).toBe("unknowable");
    s.context.allowExpectedCashForOptional = metric(true, "owner answer", P, "/health");
    s.cash.expectedBalance = metric(80_000, "read/money.getCashPosition", "now", "/money", { basis: "calculated" }); // enough expected headroom
    const allowed = assessAffordability(s, composeCashState(s, buildObligationCalendar(s)), { kind: "purchase", upfront: 10_000, mandatory: false });
    expect(allowed.answerLevel).toBe("conditional");
    expect(allowed.verdict).toBe("conditional");
    expect(allowed.reasons.join(" ")).toContain("EXPECTED cash only");
  });

  it("mandatory expense can use the conditional path without the Tune switch", () => {
    const s = uncounted();
    const a = assessAffordability(s, composeCashState(s, buildObligationCalendar(s)), { kind: "one_time_expense", upfront: 5_000, mandatory: true });
    expect(a.answerLevel).toBe("conditional");
  });
});

describe("cash projection", () => {
  it("no verified opening → RELATIVE mode, never a fake balance", () => {
    const s = uncounted();
    const p = projectCash(s, composeCashState(s, buildObligationCalendar(s)), buildObligationCalendar(s), 30);
    expect(p.mode).toBe("relative");
    expect(p.modeNote).toContain("not balances");
    expect(p.opening).toBeNull();
  });

  it("known-only scenario contains zero estimated sales", () => {
    const s = counted();
    const p = projectCash(s, composeCashState(s, buildObligationCalendar(s)), buildObligationCalendar(s), 30);
    const known = p.scenarios.find((x) => x.name === "known_only")!;
    expect(known.assumptions.join(" ")).toContain("NO estimated sales");
  });

  it("downside delays the cheque and lowers the minimum vs base", () => {
    const s = counted();
    const p = projectCash(s, composeCashState(s, buildObligationCalendar(s)), buildObligationCalendar(s), 30);
    const base = p.scenarios.find((x) => x.name === "base")!;
    const down = p.scenarios.find((x) => x.name === "downside")!;
    expect(down.minValue).toBeLessThanOrEqual(base.minValue);
    expect(down.assumptions.join(" ")).toContain("delayed");
  });

  it("reserve breach day is reported in absolute mode when it happens", () => {
    const s = counted(26_000); // just above the 25k floor, obligations will breach
    const cal = buildObligationCalendar(s);
    const p = projectCash(s, composeCashState(s, cal), cal, 30);
    const known = p.scenarios.find((x) => x.name === "known_only")!;
    expect(known.reserveBreachDay).not.toBeNull();
  });
});

describe("runway", () => {
  it("cash-generative business → coverage months, not infinite runway", () => {
    const s = counted();
    const r = computeRunway(s, composeCashState(s, buildObligationCalendar(s)));
    expect(r.available).toBe(true);
    expect(r.cashGenerative).toBe(true);
    expect(r.verifiedCoverageMonths).toBeGreaterThan(0);
    expect(r.excludes.join(" ")).toContain("owner withdrawals");
    expect(r.excludes.join(" ")).toContain("rent");
  });

  it("downside can flip cash-negative with coverage months", () => {
    const s = counted();
    // crank recurring costs to overwhelm downside inflow
    s.expenses.recurringMonthly = metric([
      { name: "Salary", avgMonthly: 60_000, isOperating: true },
      { name: "Inventory purchases", avgMonthly: 40_000, isOperating: false },
    ], "t", P, "/expenses");
    const r = computeRunway(s, composeCashState(s, buildObligationCalendar(s)));
    expect(r.downside).not.toBeNull();
    expect(r.downside!.coverageMonths == null || r.downside!.coverageMonths > 0).toBe(true);
  });

  it("zero verified cash → verified coverage null, expected coverage still shown", () => {
    const s = uncounted();
    const r = computeRunway(s, composeCashState(s, buildObligationCalendar(s)));
    expect(r.verifiedCoverageMonths).toBeNull();
    expect(r.expectedCoverageMonths).not.toBeNull();
  });
});

describe("cash priorities", () => {
  it("first cash count becomes the weekly primary when nothing burns hotter", () => {
    const s = uncounted();
    s.profit.uncoveredRevenue = metric(0, "t", P, "/reconcile"); // quiet the dq noise
    const report = buildStrategyReport(s);
    expect(report.findings.some((f) => f.id === "cash-count-required")).toBe(true);
    const w = selectWeeklyPriority(report, { dismissed: [], openActionFindingIds: [], reviewPeriodDays: 14 });
    expect(["cash-count-required", "stale-books"]).toContain(w.primary!.findingId);
  });

  it("stale count produces its own finding", () => {
    const s = counted(60_000, 12);
    const report = buildStrategyReport(s);
    expect(report.findings.some((f) => f.id === "cash-count-stale")).toBe(true);
  });

  it("cheque concentration is a monitor-level fact, never an invented risk", () => {
    const s = counted();
    const report = buildStrategyReport(s);
    const c = report.findings.find((f) => f.id === "cheque-concentration");
    expect(c).toBeDefined();
    expect(c!.urgency).toBe("monitor");
    expect(c!.class).toBe("fact");
  });
});
