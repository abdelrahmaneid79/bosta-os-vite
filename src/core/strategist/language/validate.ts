/** Provider-neutral response validation — Layer 3's border control.
 *
 *  Every provider response passes through here before the UI sees it:
 *  - numeric grounding: every significant number must exist in the snapshot,
 *    the report, the decision context, or the owner's own question/decision
 *  - confidence ceiling: no priority may claim more confidence than the
 *    Strategy Engine established for the report
 *  - disclosure: known data-quality limits must be disclosed — appended if
 *    the provider omitted them (repair, not rejection)
 *  PURE and provider-agnostic. */
import type { StrategistResponse } from "../response";
import type { LanguageRequest, ValidationReport } from "./types";

const CONF_ORDER = ["low", "medium", "high"] as const;

/** Extract significant numbers from a text (ignores tiny integers: ranks,
 *  list markers, day counts up to 31 are too ambiguous to police). */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n) && Math.abs(n) > 100) out.push(Math.abs(n));
  }
  return out;
}

/** The corpus of legal numbers for a request. */
export function buildNumberCorpus(req: LanguageRequest): Set<number> {
  const corpus = new Set<number>();
  const add = (n: number) => {
    const a = Math.abs(n);
    corpus.add(Math.round(a));
    corpus.add(Math.round(a * 10) / 10); // 1-dp values (percent points)
  };
  const walk = (x: unknown): void => {
    if (typeof x === "number" && Number.isFinite(x)) add(x);
    else if (typeof x === "string") extractNumbers(x).forEach(add);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(req.snapshot);
  walk(req.report);
  walk(req.decisionContext ?? null);
  if (req.question) extractNumbers(req.question).forEach(add);
  if (req.decision) extractNumbers(req.decision).forEach(add);
  // derived values providers legitimately mention: k-multiples of question amounts
  for (const n of [...corpus]) corpus.add(n * 1000);
  return corpus;
}

function grounded(n: number, corpus: Set<number>): boolean {
  if (corpus.has(Math.round(n))) return true;
  // tolerate rounding to hundreds/thousands of a known value
  for (const c of corpus) {
    if (c === 0) continue;
    const rel = Math.abs(n - c) / Math.max(n, c);
    if (rel <= 0.005) return true;
  }
  return false;
}

/** Validate + repair a provider response IN PLACE (returns a new object). */
export function validateResponse(req: LanguageRequest, res: StrategistResponse): { response: StrategistResponse; report: ValidationReport } {
  const repaired: string[] = [];
  const rejected: string[] = [];
  const corpus = buildNumberCorpus(req);
  const ceilingIdx = CONF_ORDER.indexOf(req.report.maxConfidence);

  const priorities = res.priorities.map((p) => {
    let out = { ...p };

    // confidence ceiling — the engine's ceiling wins, always
    if (CONF_ORDER.indexOf(p.confidence) > ceilingIdx) {
      out = { ...out, confidence: req.report.maxConfidence };
      repaired.push(`priority ${p.rank}: confidence lowered to the engine ceiling (${req.report.maxConfidence})`);
    }

    // numeric grounding across the fields owners read as claims
    const texts = [p.title, p.explanation, p.recommendedAction, p.expectedImpact, ...p.evidence.map((e) => e.value)];
    const bad = texts.flatMap(extractNumbers).filter((n) => !grounded(n, corpus));
    if (bad.length) rejected.push(`priority ${p.rank}: number(s) not in the books — ${[...new Set(bad)].slice(0, 3).join(", ")}`);
    return out;
  });

  // headline/conclusion grounding
  const headBad = [res.headline, res.conclusion].flatMap(extractNumbers).filter((n) => !grounded(n, corpus));
  if (headBad.length) rejected.push(`headline/conclusion: ungrounded number(s) ${[...new Set(headBad)].slice(0, 3).join(", ")}`);

  // disclosure repair: known data-quality limits must be present
  let dataLimitations = res.dataLimitations;
  if (req.report.dataQuality.length > 0 && dataLimitations.length === 0) {
    dataLimitations = req.report.dataQuality.slice(0, 3).map((d) => d.title);
    repaired.push("appended missing data-quality disclosures");
  }

  return {
    response: { ...res, priorities, dataLimitations },
    report: { ok: rejected.length === 0, repaired, rejected },
  };
}
