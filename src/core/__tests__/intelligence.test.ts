import { describe, it, expect } from "vitest";
import { contractViolations, RETAIL_DOMAINS, type DomainFinding } from "@/core/strategist/intelligence/contract";
import { toDomainFinding, inferDomain, toDomainFindings } from "@/core/strategist/intelligence/adapt";
import { renderFinding, renderReport } from "@/core/strategist/intelligence/nlg";
import type { Finding } from "@/core/strategist/analysis/types";

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "margin-drop", class: "warning", title: "Gross margin slipped 3.1 points",
  detail: "Gross margin fell from 41% to 37.9% while revenue held flat",
  evidence: [{ label: "Margin", value: "37.9%", source: "read/profit", period: "2026-05", screenLink: "/health" }],
  impactEgp: 4200, urgency: "this_week", confidence: "high", actionable: true,
  action: { title: "Rebalance mix", action: "shift shelf space toward the higher-margin confectionery", rationale: "r", expectedImpact: "recover ~2 margin points", urgency: "this_week", confidence: "high", screenLink: "/stock", missingData: ["next stock count"], caveats: [], reversible: true },
  alternativeAction: null, missingData: ["current cost coverage"], drivers: ["Almonds", "low-margin nuts"],
  assumptions: ["cost coverage 92%"], resolutionCriteria: "gross margin returns above the 40% floor",
  persistEligible: true, score: 10, rank: 1, ...over,
});

describe("retail intelligence contract", () => {
  it("adapted findings satisfy the 11-field contract", () => {
    const df = toDomainFinding(finding());
    expect(contractViolations(df)).toEqual([]);
    // all eleven mandated fields present
    for (const k of ["finding", "driver", "evidence", "businessContext", "recommendation", "expectedBenefit", "successCriteria", "confidence", "blockingInformation"] as (keyof DomainFinding)[]) {
      expect(df[k]).toBeDefined();
    }
  });

  it("flags a non-compliant finding", () => {
    const bad = { finding: "x", driver: "y" } as Partial<DomainFinding>;
    const v = contractViolations(bad);
    expect(v).toContain("businessContext");
    expect(v).toContain("recommendation");
  });

  it("routes findings to a known domain", () => {
    expect(inferDomain(finding({ id: "margin-drop" }))).toBe("margin");
    expect(inferDomain(finding({ id: "cash-runway-short" }))).toBe("cash");
    expect(inferDomain(finding({ id: "cheque-overdue-may" }))).toBe("cheque");
    expect(inferDomain(finding({ id: "stock-dead-almond" }))).toBe("inventory");
    expect(inferDomain(finding({ id: "opp-x", class: "opportunity" }))).toBe("growth");
    expect(RETAIL_DOMAINS).toContain(inferDomain(finding({ id: "mystery" })));
  });

  it("carries risk for risky classes, opportunity for opportunities", () => {
    expect(toDomainFinding(finding({ class: "warning" })).risk).toBeTruthy();
    expect(toDomainFinding(finding({ class: "opportunity", action: null })).opportunity).toBeTruthy();
    expect(toDomainFinding(finding({ class: "opportunity", action: null })).risk).toBeNull();
  });

  it("merges blocking information from finding and action", () => {
    const df = toDomainFinding(finding());
    expect(df.blockingInformation).toContain("current cost coverage");
    expect(df.blockingInformation).toContain("next stock count");
  });
});

describe("deterministic NLG", () => {
  it("renders a detailed consultant paragraph from the 11 fields", () => {
    const df = toDomainFinding(finding());
    const prose = renderFinding(df, "detailed");
    expect(prose).toMatch(/margin/i);
    expect(prose.toLowerCase()).toContain("shift shelf space");   // recommendation
    expect(prose).toMatch(/confidence/i);
    expect(prose).toMatch(/success looks like/i);
  });

  it("is deterministic — same finding renders identically", () => {
    const df = toDomainFinding(finding());
    expect(renderFinding(df, "detailed")).toBe(renderFinding(df, "detailed"));
  });

  it("brief style is shorter than detailed", () => {
    const df = toDomainFinding(finding());
    expect(renderFinding(df, "brief").length).toBeLessThan(renderFinding(df, "detailed").length);
  });

  it("action style leads with the recommendation", () => {
    const df = toDomainFinding(finding());
    const a = renderFinding(df, "action");
    expect(a.toLowerCase()).toContain("shift shelf space");
    expect(a).toMatch(/expected benefit/i);
  });

  it("composes a report, dedups, and can group by domain", () => {
    const findings = toDomainFindings([finding(), finding({ id: "cash-x", title: "Cash is tight", detail: "Runway is 2.1 months", drivers: ["salary"], class: "warning" })]);
    const r = renderReport(findings, { groupByDomain: true, maxFindings: 5 });
    expect(r.summary).toMatch(/Gross margin slipped/);
    expect(r.sections.map((s) => s.label)).toEqual(expect.arrayContaining(["Margin", "Cash"]));
    // no repeated lines
    const all = r.sections.flatMap((s) => s.lines);
    expect(new Set(all).size).toBe(all.length);
  });

  it("never emits an empty report body when findings exist", () => {
    const r = renderReport(toDomainFindings([finding()]));
    expect(r.body.length).toBeGreaterThan(40);
  });
});
