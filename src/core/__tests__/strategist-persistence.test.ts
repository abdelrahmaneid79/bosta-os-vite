/** Cycle 4 pure logic: insight lifecycle, action dedup, owner memory,
 *  suggested questions, withdrawal assessment, response validation. */
import { describe, expect, it } from "vitest";
import { planInsightSync, shouldPersistFinding, isDuplicateAction, buildOwnerMemory, type InsightLite } from "@/core/strategist/persistence/lifecycle";
import { suggestQuestions } from "@/core/strategist/questions";
import { assessWithdrawal } from "@/core/strategist/analysis/withdrawal";
import { computeDecisionContext } from "@/core/strategist/analysis/decision";
import { parseStrategistResponse } from "@/core/strategist/response";
import { analyzeSnapshot } from "@/core/strategist/analysis/engine";
import { makeSnapshot } from "@/core/strategist/analysis/fixture";
import { metric, missing } from "@/core/strategist/contract";
import type { Finding } from "@/core/strategist/analysis/types";

const F = (over: Partial<Finding>): Finding => ({
  id: "x", class: "warning", title: "t", detail: "d", evidence: [], impactEgp: null,
  urgency: "monitor", confidence: "medium", actionable: false, action: null,
  alternativeAction: null, missingData: [], drivers: [], assumptions: [],
  resolutionCriteria: "engine stops raising it", persistEligible: false,
  score: 0, rank: 1, ...over,
});

describe("insight lifecycle", () => {
  it("persists only above-threshold findings", () => {
    expect(shouldPersistFinding(F({ class: "contradiction" }))).toBe(true);
    expect(shouldPersistFinding(F({ class: "decision_risk" }))).toBe(true);
    expect(shouldPersistFinding(F({ urgency: "today" }))).toBe(true);
    expect(shouldPersistFinding(F({ impactEgp: 6_000 }))).toBe(true);
    expect(shouldPersistFinding(F({ class: "data_quality", urgency: "this_week" }))).toBe(true);
    expect(shouldPersistFinding(F({ class: "fact", urgency: "monitor", impactEgp: 100 }))).toBe(false);
  });

  it("new finding → insert; recurring → recur; resolved+returns → reopen; dismissed stays silent", () => {
    const existing: InsightLite[] = [
      { id: "r1", findingId: "margin-drop", status: "active" },
      { id: "r2", findingId: "withdrawals-high", status: "resolved" },
      { id: "r3", findingId: "stale-books", status: "dismissed" },
    ];
    const findings = [
      F({ id: "margin-drop", class: "contradiction" }),
      F({ id: "withdrawals-high", class: "decision_risk" }),
      F({ id: "stale-books", class: "data_quality", urgency: "today" }),
      F({ id: "overdue-cheques", class: "warning", urgency: "today" }),
    ];
    const plan = planInsightSync(existing, findings);
    expect(plan.inserts.map((f) => f.id)).toEqual(["overdue-cheques"]);
    expect(plan.recurs.map((r) => r.rowId)).toEqual(["r1"]);
    expect(plan.reopens.map((r) => r.rowId)).toEqual(["r2"]);
    expect(plan.autoResolves).toEqual([]); // r3 dismissed → untouched
  });

  it("open insight the engine no longer emits → auto-resolve (evidence-based)", () => {
    const existing: InsightLite[] = [{ id: "r1", findingId: "margin-drop", status: "acknowledged" }];
    const plan = planInsightSync(existing, [F({ id: "steady-state", class: "fact" })]);
    expect(plan.autoResolves).toEqual(["r1"]);
  });

  it("action dedup blocks a second OPEN action for the same finding only", () => {
    const existing = [
      { id: "a1", findingId: "margin-drop", status: "accepted" },
      { id: "a2", findingId: "stock-risk", status: "completed" },
    ];
    expect(isDuplicateAction(existing, "margin-drop")).toBe(true);
    expect(isDuplicateAction(existing, "stock-risk")).toBe(false); // closed → new one allowed
    expect(isDuplicateAction(existing, null)).toBe(false);         // owner tasks never dedupe
  });

  it("owner memory carries decisions and rejections, capped, never numbers", () => {
    const mem = buildOwnerMemory({
      completedActions: [{ title: "Restock سوداني", completionNote: "ordered 20kg", completedAt: "2026-07-01T10:00:00Z" }],
      rejectedFeedback: [{ verdict: "incorrect", reason: "rent is prepaid quarterly", subjectTitle: "Rent spike warning" }],
      dismissedInsights: [{ title: "Inventory has no live data", ownerNote: "counting next week" }],
    });
    expect(mem.some((m) => m.includes("Restock سوداني"))).toBe(true);
    expect(mem.some((m) => m.includes("INCORRECT") && m.includes("rent is prepaid"))).toBe(true);
    expect(mem.some((m) => m.includes("do not re-raise"))).toBe(true);
  });
});

describe("suggested questions", () => {
  it("come from live findings, deduped, capped, never empty", () => {
    const s = makeSnapshot();
    const withdrawHeavy = analyzeSnapshot(makeSnapshot({ expenses: { withdrawals: metric(20_000, "t", "p", "/money") } }));
    const qs = suggestQuestions(s, withdrawHeavy);
    expect(qs.length).toBeGreaterThan(1);
    expect(qs.length).toBeLessThanOrEqual(6);
    expect(qs.some((q) => q.mode === "decision_support")).toBe(true); // withdrawals-high present
    expect(new Set(qs.map((q) => q.text)).size).toBe(qs.length);
  });
});

describe("withdrawal assessment", () => {
  it("healthy books: safe within both limits, recommends min(headroom, guideline)", () => {
    const s = makeSnapshot();
    const a = assessWithdrawal(s, computeDecisionContext(s), 10_000);
    expect(a.verdict).toBe("safe");
    expect(a.recommendedMax).toBe(13_500); // min(35k headroom, 13.5k guideline)
    expect(a.profitContext).toContain("Profit is timing, not cash");
  });

  it("amount above cash headroom → unsafe with the exact shortfall named", () => {
    const s = makeSnapshot();
    const a = assessWithdrawal(s, computeDecisionContext(s), 40_000);
    expect(a.verdict).toBe("unsafe");
    expect(a.reasonsToWait.join(" ")).toContain("below your EGP 25,000 reserve floor");
  });

  it("profitable but cash-untracked → unknowable, low confidence, count-first advice", () => {
    const s = makeSnapshot({ cash: { hasLiveData: false, expectedBalance: missing("t", "p", "/money", "no data") } });
    const a = assessWithdrawal(s, computeDecisionContext(s), 10_000);
    expect(a.verdict).toBe("unknowable");
    expect(a.confidence).toBe("low");
    expect(a.reasonsToWait[0]).toContain("first drawer count");
    expect(a.headroom).toContain("Unknowable");
  });

  it("within cash headroom but above the profit guideline → tight, both limits shown", () => {
    const s = makeSnapshot();
    const a = assessWithdrawal(s, computeDecisionContext(s), 20_000); // headroom 35k, guideline 13.5k
    expect(a.verdict).toBe("tight");
    expect(a.reasonsToWait.join(" ")).toContain("guideline");
  });
});

describe("response validation", () => {
  it("valid payload round-trips; malformed throws", () => {
    const ok = parseStrategistResponse({
      mode: "daily_brief", headline: "h", conclusion: "c",
      priorities: [{ rank: 1, type: "risk", title: "t", explanation: "e", evidence: [{ label: "l", value: "v", source: "s", period: "p", screenLink: "/x" }], recommendedAction: "a", expectedImpact: "i", urgency: "today", confidence: "high", missingData: [] }],
      contradictions: [], dataLimitations: [], suggestedQuestions: [],
    });
    expect(ok.priorities[0].urgency).toBe("today");
    expect(() => parseStrategistResponse({ headline: "x" })).toThrow();
    expect(() => parseStrategistResponse(null)).toThrow();
  });

  it("out-of-enum values degrade to safe defaults, never crash the UI", () => {
    const r = parseStrategistResponse({
      mode: "question", headline: "h", conclusion: "c",
      priorities: [{ rank: "x", type: "??", title: 1, explanation: null, evidence: "no", recommendedAction: 0, expectedImpact: 0, urgency: "??", confidence: "??", missingData: "??" }],
    });
    expect(r.priorities[0].type).toBe("action");
    expect(r.priorities[0].urgency).toBe("monitor");
    expect(r.priorities[0].confidence).toBe("low");
    expect(r.priorities[0].evidence).toEqual([]);
  });
});
