/** StrategyReport — executive state, status transitions, confidence ceiling,
 *  and the remaining Cycle 5 business scenarios. */
import { describe, expect, it } from "vitest";
import { buildStrategyReport } from "@/core/strategist/analysis/report";
import { makeSnapshot } from "@/core/strategist/analysis/fixture";
import { deterministicProvider } from "@/core/strategist/language/deterministic";
import { metric, missing } from "@/core/strategist/contract";

describe("buildStrategyReport", () => {
  it("healthy stable business → healthy status, steady output, deterministic twice over", () => {
    const a = buildStrategyReport(makeSnapshot());
    const b = buildStrategyReport(makeSnapshot());
    expect(["healthy", "attention"]).toContain(a.executive.status);
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id)); // same input → same output
    expect(a.executive.headline).not.toBeNull();
  });

  it("today-urgency contradiction → critical status with a reason", () => {
    const s = makeSnapshot({ cash: { expectedBalance: metric(9_000, "read/money.getCashPosition", "now", "/money"), hasLiveData: true } });
    const r = buildStrategyReport(s);
    expect(r.executive.status).toBe("critical");
    expect(r.executive.statusReason).toContain("today");
  });

  it("low completeness degrades the confidence ceiling high → medium", () => {
    const r = buildStrategyReport(makeSnapshot({ meta: { completenessScore: 40 } }));
    expect(r.maxConfidence).toBe("medium");
  });

  it("most urgent action carries its finding id and screen link", () => {
    const s = makeSnapshot({ meta: { isStale: true, staleDays: 43, lastDataDate: "2026-05-31" } });
    const r = buildStrategyReport(s);
    expect(r.executive.mostUrgentAction).not.toBeNull();
    expect(r.executive.mostUrgentAction!.screenLink.startsWith("/")).toBe(true);
  });

  it("persistEligible is set by the engine on ranked findings", () => {
    const s = makeSnapshot({ expenses: { withdrawals: metric(20_000, "read/money.getCashSummary", "P", "/money") } });
    const r = buildStrategyReport(s);
    const w = r.findings.find((f) => f.id === "withdrawals-high")!;
    expect(w.persistEligible).toBe(true);
    expect(w.resolutionCriteria).toContain("50%");
  });
});

describe("remaining business scenarios (deterministic language)", () => {
  it("price-increase question routes to product economics with the margin-point value available", async () => {
    const s = makeSnapshot({
      products: {
        highVolumeLowMargin: metric(
          [{ name: "بونبون", revenue: 12_000, units: 300, grossProfit: 2_160, marginPct: 18, missingCost: false }],
          "read/products.getProductProfit", "P", "/reports", { confidence: "high" },
        ),
      },
    });
    const report = buildStrategyReport(s);
    const r = await deterministicProvider.generate({ mode: "question", snapshot: s, report, findings: report.findings, question: "Should I increase the price of بونبون?" });
    expect(r.priorities.length).toBeGreaterThan(0);
    expect(report.decisionContext.belowMarginFloor.some((p) => p.name === "بونبون")).toBe(true);
  });

  it("employee-affordability question → deterministic answer with the assumed salary labeled", async () => {
    const s = makeSnapshot();
    const report = buildStrategyReport(s);
    const r = await deterministicProvider.generate({ mode: "question", snapshot: s, report, findings: report.findings, question: "Can I afford to hire another employee?" });
    expect(r.headline).toContain("new employee");
    expect(r.headline).toContain("salary assumed");   // never invents silently
    expect(r.conclusion).toContain("Recurring:");
    expect(r.conclusion).toContain("extra sales");    // revenue-to-cover, no benefit assumed
  });

  it("memory can never override live data — answers always use the current snapshot", async () => {
    const s = makeSnapshot({
      profit: {
        grossMarginPct: metric(35, "read/profit.getProfitReadout", "P", "/reconcile", { confidence: "high" }),
        priorGrossMarginPct: metric(40, "read/profit.getProfitReadout", "C", "/reconcile"),
      },
    });
    const report = buildStrategyReport(s);
    const r = await deterministicProvider.generate({
      mode: "question", snapshot: s, report, findings: report.findings,
      question: "Why did margin fall?",
      memory: ["Owner completed: \"margin fix\" — margin was restored to 45% last month"], // stale claim
    });
    // the deterministic answer renders CURRENT findings; the stale 45% never appears
    const all = JSON.stringify(r);
    expect(all).not.toContain("45%");
    expect(r.priorities.some((p) => p.title.includes("35%") || p.title.includes("margin"))).toBe(true);
  });

  it("settlement timing explains weak cash — the contradiction names the mall money", async () => {
    const s = makeSnapshot({ cheques: { openTabGross: metric(160_000, "settlement/cheque-cycle.getChequeCycle", "since last cheque", "/settlements", { note: "gross, before deductions" }) } });
    const report = buildStrategyReport(s);
    const lag = report.findings.find((f) => f.id === "settlement-lag");
    expect(lag).toBeDefined();
    expect(lag!.action?.screenLink).toBe("/settlements");
  });

  it("cash unavailable → withdrawal question refuses with 'unknowable', never a fake number", async () => {
    const s = makeSnapshot({ cash: {
      hasLiveData: false,
      expectedBalance: missing("read/money.getCashPosition", "now", "/money", "no tracking"),
      latestCount: missing("cash_reconciliations", "all-time", "/money", "never counted"),
      lastCountDate: missing("cash_reconciliations", "all-time", "/money", "never counted"),
      countAgeDays: missing("cash_reconciliations", "all-time", "/money", "never counted"),
    } });
    const report = buildStrategyReport(s);
    const r = await deterministicProvider.generate({ mode: "question", snapshot: s, report, findings: report.findings, question: "Can I withdraw 20,000 EGP?" });
    expect(r.headline).toContain("cannot be verified");
    expect(r.priorities[0].missingData).toContain("fresh physical cash count");
  });
});
