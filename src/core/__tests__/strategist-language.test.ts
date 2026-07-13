/** Layer 3 — provider independence, deterministic templates, router fallback,
 *  numeric grounding, confidence ceilings. NO network, NO API keys anywhere. */
import { describe, expect, it } from "vitest";
import { makeSnapshot } from "@/core/strategist/analysis/fixture";
import { buildStrategyReport } from "@/core/strategist/analysis/report";
import { deterministicProvider } from "@/core/strategist/language/deterministic";
import { generateLanguage, registerProvider } from "@/core/strategist/language/router";
import { validateResponse, extractNumbers, buildNumberCorpus } from "@/core/strategist/language/validate";
import { metric } from "@/core/strategist/contract";
import type { LanguageProvider, LanguageRequest } from "@/core/strategist/language/types";
import type { StrategistResponse } from "@/core/strategist/response";

function reqFor(mode: LanguageRequest["mode"], over: Partial<LanguageRequest> = {}): LanguageRequest {
  const snapshot = over.snapshot ?? makeSnapshot();
  const report = buildStrategyReport(snapshot);
  return { mode, snapshot, report, findings: report.findings, ...over };
}

const SETTINGS = { provider: "anthropic" as const, allowEnhanced: true, maxCallsPerDay: 25 };

/* ── deterministic provider (works with zero credentials) ─────────────── */

describe("deterministic template provider", () => {
  it("briefing renders the executive state with real findings, no model", async () => {
    const r = await deterministicProvider.generate(reqFor("daily_brief"));
    expect(r.headline.length).toBeGreaterThan(10);
    expect(r.priorities.length).toBeGreaterThan(0);
    expect(r.priorities[0].evidence.length).toBeGreaterThan(0);
  });

  it("answers 'can I withdraw 20,000' deterministically with separated money concepts", async () => {
    const r = await deterministicProvider.generate(reqFor("question", { question: "Can I safely withdraw 20,000 EGP?" }));
    expect(r.headline).toContain("EGP 20,000");
    const p = r.priorities[0];
    expect(p.explanation).toContain("Reserve floor");
    expect(p.explanation).toContain("Profit context");
    expect(p.evidence.some((e) => e.label === "Net profit")).toBe(true);
  });

  it("refuses unsupported questions honestly and offers the nearest supported ones", async () => {
    const r = await deterministicProvider.generate(reqFor("question", { question: "Should I franchise the brand internationally?" }));
    expect(r.headline).toContain("enhanced language service");
    expect(r.suggestedQuestions.length).toBeGreaterThan(0);
    expect(r.conclusion).toContain("deterministically");
  });

  it("topic questions are answered from findings (margin → margin findings)", async () => {
    const s = makeSnapshot({
      profit: {
        grossMarginPct: metric(35, "read/profit.getProfitReadout", "P", "/reconcile", { confidence: "high" }),
        priorGrossMarginPct: metric(40, "read/profit.getProfitReadout", "C", "/reconcile"),
      },
    });
    const r = await deterministicProvider.generate(reqFor("question", { snapshot: s, question: "Why did margin fall?" }));
    expect(r.priorities.some((p) => p.title.includes("margin"))).toBe(true);
  });

  it("non-withdrawal decision → context + explicit refusal of fake precision", async () => {
    const r = await deterministicProvider.generate(reqFor("decision_support", { decision: "hire another employee for 4000/month" }));
    expect(r.conclusion).toContain("will not fake a projection");
  });
});

/* ── router: fallback + provider independence ─────────────────────────── */

const fake = (behavior: "ok" | "throw" | "invent" | "overconfident" | "unavailable"): LanguageProvider => ({
  id: "fake",
  async isAvailable() { return behavior !== "unavailable"; },
  async health() { return { id: "fake", available: behavior !== "unavailable", detail: behavior }; },
  async generate(req): Promise<StrategistResponse> {
    if (behavior === "throw") throw new Error("boom");
    const base: StrategistResponse = {
      mode: req.mode, headline: "Fake headline", conclusion: "Fake conclusion grounded in EGP 114,000 revenue.",
      priorities: [{
        rank: 1, type: "risk", title: "Fake risk", explanation: "Based on EGP 27,000 net profit.",
        evidence: [{ label: "Net profit", value: "EGP 27,000", source: "read/profit.getProfitReadout", period: "P", screenLink: "/reconcile" }],
        recommendedAction: "Do the thing.", expectedImpact: "solid",
        urgency: "this_week", confidence: behavior === "overconfident" ? "high" : "medium",
        missingData: [],
      }],
      contradictions: [], dataLimitations: ["known limit"], suggestedQuestions: [],
    };
    if (behavior === "invent") base.priorities[0].explanation = "Competitors average EGP 999,777 monthly."; // not in the books
    return base;
  },
});

describe("provider router", () => {
  it("not enhanced → deterministic, no fallback flag, no external call", async () => {
    const res = await generateLanguage(reqFor("daily_brief"), { settings: SETTINGS });
    expect(res.provider).toBe("deterministic");
    expect(res.fallback).toBe(false);
  });

  it("a FAKE provider plugs in without touching core layers", async () => {
    registerProvider(fake("ok"));
    const res = await generateLanguage(reqFor("daily_brief"), { enhanced: true, settings: { ...SETTINGS, provider: "fake" as never } });
    expect(res.provider).toBe("fake");
    expect(res.fallback).toBe(false);
    expect(res.response.headline).toBe("Fake headline");
  });

  it("provider throws → deterministic fallback with the reason, never a blank screen", async () => {
    registerProvider(fake("throw"));
    const res = await generateLanguage(reqFor("daily_brief"), { enhanced: true, settings: { ...SETTINGS, provider: "fake" as never } });
    expect(res.provider).toBe("deterministic");
    expect(res.fallback).toBe(true);
    expect(res.fallbackReason).toContain("boom");
    expect(res.response.priorities.length).toBeGreaterThan(0); // engine output never discarded
  });

  it("provider unavailable → deterministic fallback", async () => {
    registerProvider(fake("unavailable"));
    const res = await generateLanguage(reqFor("daily_brief"), { enhanced: true, settings: { ...SETTINGS, provider: "fake" as never } });
    expect(res.fallback).toBe(true);
    expect(res.fallbackReason).toContain("not available");
  });

  it("provider invents a number → response REJECTED, deterministic fallback names it", async () => {
    registerProvider(fake("invent"));
    const res = await generateLanguage(reqFor("daily_brief"), { enhanced: true, settings: { ...SETTINGS, provider: "fake" as never } });
    expect(res.provider).toBe("deterministic");
    expect(res.fallback).toBe(true);
    expect(res.fallbackReason).toContain("not in the books");
  });

  it("confidence above the engine ceiling is DOWNGRADED, not passed through", async () => {
    registerProvider(fake("overconfident"));
    const snapshot = makeSnapshot({ meta: { completenessScore: 40 } }); // ceiling degrades high→medium
    const report = buildStrategyReport(snapshot);
    expect(report.maxConfidence).toBe("medium");
    const res = await generateLanguage({ mode: "daily_brief", snapshot, report, findings: report.findings },
      { enhanced: true, settings: { ...SETTINGS, provider: "fake" as never } });
    expect(res.fallback).toBe(false);
    expect(res.response.priorities[0].confidence).toBe("medium");
    expect(res.validation.repaired.join(" ")).toContain("ceiling");
  });

  it("daily call budget exhausted → deterministic with a clear reason", async () => {
    registerProvider(fake("ok"));
    const res = await generateLanguage(reqFor("daily_brief"), { enhanced: true, settings: { ...SETTINGS, provider: "fake" as never, maxCallsPerDay: 0 } });
    expect(res.fallback).toBe(true);
    expect(res.fallbackReason).toContain("limit");
  });
});

/* ── validator internals ───────────────────────────────────────────────── */

describe("grounding validator", () => {
  it("extracts significant numbers only", () => {
    expect(extractNumbers("Revenue EGP 114,000 rose 3.6% over 31 days")).toEqual([114000]);
  });

  it("corpus contains snapshot values incl. 1-dp percents", () => {
    const req = reqFor("daily_brief");
    const corpus = buildNumberCorpus(req);
    expect(corpus.has(114000)).toBe(true);  // period revenue
    expect(corpus.has(27000)).toBe(true);   // net profit
  });

  it("appends missing data-quality disclosures instead of rejecting", () => {
    const req = reqFor("daily_brief", { snapshot: makeSnapshot({ profit: { uncoveredRevenue: metric(70_000, "t", "P", "/reconcile") } }) });
    const clean: StrategistResponse = {
      mode: "daily_brief", headline: "ok", conclusion: "ok",
      priorities: [], contradictions: [], dataLimitations: [], suggestedQuestions: [],
    };
    const { response, report } = validateResponse(req, clean);
    expect(report.ok).toBe(true);
    expect(response.dataLimitations.length).toBeGreaterThan(0);
    expect(report.repaired.join(" ")).toContain("disclosures");
  });
});
