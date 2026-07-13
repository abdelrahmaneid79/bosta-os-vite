// TEMP: Cycle 7 production validation — the REAL current money position
// (never counted, anchor 2026-07-01 with zero recorded activity, books 43d stale)
import { makeSnapshot } from "@/core/strategist/analysis/fixture";
import { metric, missing } from "@/core/strategist/contract";
import { buildObligationCalendar, composeCashState } from "@/core/strategist/analysis/cash";
import { assessWithdrawalV2, assessAffordability } from "@/core/strategist/analysis/affordability";
import { projectCash, computeRunway } from "@/core/strategist/analysis/forecast-cash";

const s = makeSnapshot({
  meta: { today: "2026-07-13", lastDataDate: "2026-05-31", staleDays: 43, isStale: true },
  cash: {
    hasLiveData: false,
    latestCount: missing("cash_reconciliations", "all-time", "/money", "never counted"),
    lastCountDate: missing("cash_reconciliations", "all-time", "/money", "never counted"),
    countAgeDays: missing("cash_reconciliations", "all-time", "/money", "never counted"),
    expectedBalance: metric(0, "read/money.getCashPosition", "now", "/money", { basis: "calculated", note: "opening anchor 2026-07-01 (0) + nothing recorded since" }),
    withdrawals: metric(0, "read/money.getCashSummary", "period", "/money"),
  },
  cheques: {
    openTabGross: metric(0, "cheque-cycle", "since last cheque", "/settlements"),
    openTabEstimatedNet: metric(0, "cheque-cycle", "since last cheque", "/settlements"),
    lastChequeDate: metric("2026-06-29", "cheques", "latest", "/cheques"),
    interChequeGapDays: metric(10, "cheques (median gap)", "all-time", "/cheques", { basis: "calculated" }),
    nextChequeEta: metric("2026-07-09", "cheques (last + median gap)", "estimate", "/cheques", { basis: "estimated", confidence: "medium" }),
  },
  expenses: {
    recurringMonthly: metric([
      { name: "Salary", avgMonthly: 5_700, isOperating: true },
      { name: "Inventory purchases", avgMonthly: 66_759, isOperating: false },
    ], "read/expenses (derived)", "recent", "/expenses"),
  },
});

const cal = buildObligationCalendar(s);
const cash = composeCashState(s, cal);
console.log("═══ CASH STATE (production)");
console.log("  available:", cash.available.note, "| verdict:", cash.safety.verdict);
console.log("  expected:", cash.expected.ledgerExpected, "| open pipe:", cash.expected.openSettlementNet);
console.log("  committed 30d:", cash.committed.next30, "| reserve:", cash.safety.requiredReserve, "—", cash.safety.reserveBasis);
console.log("  blockers:", cash.safety.blockers.join(" · "));
console.log("  uncertain:", cash.uncertain.length, "dimensions");

const w = assessWithdrawalV2(s, cash, 20_000);
console.log("\n═══ WITHDRAW 20,000 →", w.verdict, `(${w.answerLevel})`, "| max:", w.recommendedMax, "| next:", w.nextStep);

const p1 = assessAffordability(s, cash, { kind: "purchase", upfront: 30_000, mandatory: false, label: "stock purchase" });
console.log("═══ BUY 30,000 STOCK →", p1.verdict, `(${p1.answerLevel})`, "|", p1.reasons[0] ?? "");

const p2 = assessAffordability(s, cash, { kind: "employee", upfront: 0, recurringMonthly: 5_700, mandatory: false, label: "employee (TEST ASSUMPTION: salary = current 5,700 pattern)" });
console.log("═══ HIRE @5,700 (labeled assumption) →", p2.verdict, "| revenue to cover:", p2.recurring?.revenueToCover, p2.recurring?.marginBasis);

const proj = projectCash(s, cash, cal, 30);
console.log("\n═══ 30-DAY PROJECTION → mode:", proj.mode, "|", proj.modeNote.slice(0, 90));
const run = computeRunway(s, cash);
console.log("═══ RUNWAY → generative:", run.cashGenerative, "| verified coverage:", run.verifiedCoverageMonths, "| expected coverage:", run.expectedCoverageMonths, "months | opex:", run.monthlyOperatingCosts);
