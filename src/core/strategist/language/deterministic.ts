/** Deterministic Template Provider — the MANDATORY provider. Zero API keys,
 *  zero cost, always available. It renders Strategy Engine output into clear
 *  owner language and it never pretends to reason beyond what the engine
 *  established: unsupported questions get an honest refusal that names what
 *  IS answerable. */
import type { Finding } from "../analysis/types";
import { assessWithdrawal } from "../analysis/withdrawal";
import { suggestQuestions } from "../questions";
import type { StrategistResponse, ResponsePriority, PriorityType } from "../response";
import type { LanguageProvider, LanguageRequest, ProviderHealth } from "./types";

const egp = (n: number) => `EGP ${Math.round(n).toLocaleString("en-US")}`;

const TYPE_MAP: Record<Finding["class"], PriorityType> = {
  warning: "risk", contradiction: "contradiction", decision_risk: "risk",
  opportunity: "opportunity", data_quality: "data", fact: "action",
  forecast: "action", recommendation: "action",
};

/** Finding → priority, VERBATIM — templates never alter evidence or ranking. */
export function findingToPriority(f: Finding): ResponsePriority {
  return {
    rank: f.rank,
    type: TYPE_MAP[f.class],
    title: f.title,
    explanation: [f.detail, f.drivers.length ? `Driven by: ${f.drivers.join(", ")}.` : "", f.assumptions.length ? `Assumes: ${f.assumptions.join("; ")}.` : ""].filter(Boolean).join(" "),
    evidence: f.evidence,
    recommendedAction: f.action ? f.action.action : f.alternativeAction ?? "No action needed — keep monitoring.",
    expectedImpact: f.action?.expectedImpact ?? (f.impactEgp != null ? `${egp(f.impactEgp)} at stake` : "unquantified"),
    urgency: f.urgency,
    confidence: f.confidence,
    missingData: f.missingData,
  };
}

function base(req: LanguageRequest, headline: string, conclusion: string, picked: Finding[]): StrategistResponse {
  const r = req.report;
  return {
    mode: req.mode,
    headline,
    conclusion,
    priorities: picked.map(findingToPriority),
    contradictions: r.contradictions.map((c) => c.title),
    dataLimitations: [
      ...(r.freshness.isStale && r.freshness.staleDays != null ? [`Books are ${r.freshness.staleDays} days behind (to ${r.freshness.lastDataDate}).`] : []),
      ...r.dataQuality.slice(0, 3).map((d) => d.title),
    ],
    suggestedQuestions: suggestQuestions(req.snapshot, req.findings, 3).map((q) => q.text),
  };
}

const STATUS_LINE: Record<string, string> = {
  healthy: "The business looks steady",
  attention: "The business needs attention",
  critical: "Something needs you today",
  insufficient_data: "The books can't answer this yet",
};

function briefing(req: LanguageRequest): StrategistResponse {
  const ex = req.report.executive;
  const parts: string[] = [ex.statusReason];
  if (ex.mostUrgentAction) parts.push(`First move: ${ex.mostUrgentAction.action}`);
  const picked = [ex.headline, ex.topRisk, ex.topOpportunity, ex.topDataIssue]
    .filter((f): f is Finding => !!f)
    .filter((f, i, a) => a.findIndex((x) => x.id === f.id) === i)
    .slice(0, req.mode === "daily_brief" ? 4 : 6);
  return base(req,
    `${STATUS_LINE[ex.status]}${ex.headline ? ` — ${ex.headline.title.toLowerCase()}` : ""}`,
    parts.join(" "),
    picked);
}

function withdrawal(req: LanguageRequest, amount: number): StrategistResponse {
  const wa = assessWithdrawal(req.snapshot, req.report.decisionContext, amount);
  const VERDICT: Record<string, string> = {
    safe: `${egp(amount)} is affordable within both your cash headroom and the profit guideline.`,
    tight: `${egp(amount)} fits your cash headroom but exceeds the profit guideline — possible, not comfortable.`,
    unsafe: `${egp(amount)} is not safely affordable — it breaks your reserve floor.`,
    unknowable: `Whether ${egp(amount)} is affordable cannot be verified yet.`,
  };
  const kv: [string, string][] = [
    ["Cash position", wa.cashPosition], ["Reserve floor", wa.reserveFloor],
    ["Headroom", wa.headroom], ["Profit context", wa.profitContext],
    ["Money at the mall", wa.settlementContext], ["Freshness", wa.dataFreshness],
  ];
  const p: ResponsePriority = {
    rank: 1, type: wa.verdict === "unsafe" || wa.verdict === "unknowable" ? "risk" : "action",
    title: `Withdrawal check: ${egp(amount)}`,
    explanation: kv.map(([k, v]) => `${k}: ${v}`).join(" · "),
    evidence: [
      { label: "Expected cash", value: req.snapshot.cash.expectedBalance.value != null ? egp(req.snapshot.cash.expectedBalance.value) : "unknown", source: req.snapshot.cash.expectedBalance.source, period: req.snapshot.cash.expectedBalance.period, screenLink: "/money" },
      { label: "Net profit", value: req.snapshot.profit.netProfit.value != null ? egp(req.snapshot.profit.netProfit.value) : "unknown (withheld)", source: req.snapshot.profit.netProfit.source, period: req.snapshot.profit.netProfit.period, screenLink: "/reconcile" },
    ],
    recommendedAction: wa.recommendedMax != null
      ? (amount <= wa.recommendedMax ? `Proceed — and record it as a withdrawal so cash stays honest.` : `Cap this draw at ${egp(wa.recommendedMax)} or wait for the next cheque.`)
      : "Do the first drawer count, then re-run this check.",
    expectedImpact: wa.recommendedMax != null ? `keeps you above the reserve floor` : "unlocks cash verification",
    urgency: "today", confidence: wa.confidence,
    missingData: wa.verdict === "unknowable" ? ["first physical cash count"] : [],
  };
  return {
    mode: req.mode, headline: VERDICT[wa.verdict],
    conclusion: wa.reasonsToWait.length ? `Before deciding: ${wa.reasonsToWait.join(" ")}` : "No blockers found in the current books.",
    priorities: [p], contradictions: [],
    dataLimitations: req.report.dataQuality.slice(0, 2).map((d) => d.title),
    suggestedQuestions: [],
  };
}

/** intent → the findings that answer it (supported deterministic questions) */
const INTENTS: { match: RegExp; ids?: string[]; classes?: Finding["class"][]; headline: string }[] = [
  { match: /margin|هامش|profit.*(fall|drop|weak)|ربح/i, ids: ["margin-drop", "growth-weaker-economics", "uncovered-revenue", "missing-costs"], headline: "What the engine knows about margin" },
  { match: /cash|كاش|نقد|drawer/i, ids: ["profit-up-cash-low", "cash-not-tracked", "withdrawals-high"], headline: "What the engine knows about cash" },
  { match: /cheque|شيك|settle|mall/i, ids: ["overdue-cheques", "settlement-lag"], headline: "Where the settlement cycle stands" },
  { match: /stock|مخزون|restock|inventory/i, ids: ["stock-risk", "inventory-not-tracked"], headline: "Where stock stands" },
  { match: /fix|أصلح|first|priorit|week|matters/i, classes: ["contradiction", "decision_risk", "warning", "data_quality"], headline: "What to fix first" },
  { match: /improv|better|grow|بتتحسن|أحسن/i, ids: ["revenue-up", "revenue-down", "margin-gain", "margin-drop", "behind-target", "growth-weaker-economics"], headline: "Is the business improving" },
  { match: /product|منتج|sell|shelf/i, classes: ["opportunity"], headline: "Product economics" },
  { match: /missing|ناقص|data|information/i, classes: ["data_quality"], headline: "What data is missing" },
];

function answerQuestion(req: LanguageRequest): StrategistResponse {
  const q = req.question ?? "";
  // withdrawal amounts: "20,000", "20000", "20k"
  const wd = /(?:withdraw|سحب|اسحب|take out).*?([\d,.]+)\s*(k|K|الف|ألف)?|([\d,.]+)\s*(k|K)?\s*(?:EGP|جنيه).*?(?:withdraw|سحب)/i.exec(q);
  if (wd) {
    const raw = (wd[1] ?? wd[3] ?? "").replace(/[,،]/g, "");
    let amt = Number(raw);
    if (wd[2] || wd[4]) amt *= 1000;
    if (Number.isFinite(amt) && amt > 0) return withdrawal(req, amt);
  }

  for (const intent of INTENTS) {
    if (!intent.match.test(q)) continue;
    const picked = req.findings.filter((f) =>
      (intent.ids?.includes(f.id) ?? false) || (intent.classes?.includes(f.class) ?? false)).slice(0, 4);
    if (picked.length) {
      return base(req, intent.headline,
        `Deterministic answer from the current books (${req.report.period}). Each item links to its evidence.`,
        picked);
    }
    return base(req, intent.headline,
      "The engine found nothing significant on this topic in the current period — that itself is the answer.",
      req.findings.slice(0, 1));
  }

  // honest refusal — say what IS supported instead of bluffing
  const nearest = suggestQuestions(req.snapshot, req.findings, 3).map((s) => s.text);
  return {
    mode: req.mode,
    headline: "That question needs the enhanced language service",
    conclusion: `Without it, I can answer questions about margin, cash, cheques, stock, products, data gaps, priorities, and withdrawal amounts — deterministically, from the audited books. Free-form questions like this one need the enhanced service (Tune → language settings)${req.report.dataQuality.length ? ", and some answers also need the missing data below" : ""}.`,
    priorities: req.report.executive.headline ? [findingToPriority(req.report.executive.headline)] : [],
    contradictions: [],
    dataLimitations: req.report.dataQuality.slice(0, 3).map((d) => d.title),
    suggestedQuestions: nearest,
  };
}

function byClasses(req: LanguageRequest, classes: Finding["class"][], ids: string[], headline: string): StrategistResponse {
  const picked = req.findings.filter((f) => classes.includes(f.class) || ids.includes(f.id)).slice(0, 5);
  return base(req, headline,
    picked.length ? `${picked.length} relevant finding(s) in ${req.report.period}, ranked by impact.` : "Nothing significant found in the current period.",
    picked.length ? picked : req.findings.slice(0, 1));
}

export class DeterministicProvider implements LanguageProvider {
  readonly id = "deterministic";
  async isAvailable(): Promise<boolean> { return true; }
  async health(): Promise<ProviderHealth> { return { id: this.id, available: true, detail: "built-in templates — no API required" }; }

  async generate(req: LanguageRequest): Promise<StrategistResponse> {
    switch (req.mode) {
      case "daily_brief":
      case "weekly_review":
        return briefing(req);
      case "question":
        return answerQuestion(req);
      case "decision_support": {
        const amt = /([\d,.]+)\s*(k|K)?/.exec((req.decision ?? "").replace(/[,،]/g, ""));
        const n = amt ? Number(amt[1]) * (amt[2] ? 1000 : 1) : NaN;
        if (/withdraw|سحب/i.test(req.decision ?? "") && Number.isFinite(n) && n > 0) return withdrawal(req, n);
        // non-withdrawal decisions: present the deterministic context, refuse fake precision
        const dc = req.report.decisionContext;
        return {
          mode: req.mode,
          headline: "Here is what the books can say about this decision",
          conclusion: `The engine will not fake a projection it can't support. Known: cash headroom ${dc.cashHeadroomAboveFloor != null ? egp(dc.cashHeadroomAboveFloor) : "unknown"}, one margin point ≈ ${dc.marginPointValue != null ? egp(dc.marginPointValue) + "/period" : "unknown"}, ~${dc.openTabEstimatedNet != null ? egp(dc.openTabEstimatedNet) : "unknown"} due from the mall.${dc.caveats.length ? ` Caveats: ${dc.caveats.join("; ")}.` : ""} For a reasoned recommendation on this specific decision, use the enhanced service.`,
          priorities: req.findings.filter((f) => f.class === "decision_risk" || f.class === "contradiction").slice(0, 2).map(findingToPriority),
          contradictions: req.report.contradictions.map((c) => c.title),
          dataLimitations: dc.caveats,
          suggestedQuestions: ["How much can I safely withdraw this month?"],
        };
      }
      case "product_strategy":
        return byClasses(req, ["opportunity"], ["growth-driver", "decline-driver", "stock-risk", "missing-costs"], "Product economics — deterministic view");
      case "cash_review":
        return byClasses(req, [], ["profit-up-cash-low", "cash-not-tracked", "withdrawals-high"], "Cash review — deterministic view");
      case "cheque_review":
        return byClasses(req, [], ["overdue-cheques", "settlement-lag"], "Settlement & cheque review");
      case "data_quality_review":
        return byClasses(req, ["data_quality"], [], "Data quality — what's missing and what it distorts");
    }
  }
}

export const deterministicProvider = new DeterministicProvider();
