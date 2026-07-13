/** Deterministic Template Provider — the MANDATORY provider. Zero API keys,
 *  zero cost, always available. It renders Strategy Engine output into clear
 *  owner language and it never pretends to reason beyond what the engine
 *  established: unsupported questions get an honest refusal that names what
 *  IS answerable. */
import type { Finding } from "../analysis/types";
import { assessWithdrawalV2, assessAffordability } from "../analysis/affordability";
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

function rootCauseLine(req: LanguageRequest): string | null {
  const rc = req.report.revenueContribution;
  if (!rc.available || (rc.positive.length === 0 && rc.negative.length === 0)) return null;
  const dir = rc.totalChange >= 0 ? "growth" : "decline";
  const top = (rc.totalChange >= 0 ? rc.positive : rc.negative).slice(0, 3);
  if (!top.length) return null;
  const drivers = top.map((d) => `${d.name} (${d.delta >= 0 ? "+" : "−"}${egp(Math.abs(d.delta))})`).join(", ");
  const expl = rc.explainedPct != null ? ` — product detail explains ${rc.explainedPct}% of the change` : "";
  return `Root cause of the revenue ${dir}: ${drivers}${expl}${rc.unexplained !== 0 ? `; ${egp(Math.abs(rc.unexplained))} sits on days without product detail` : ""}.`;
}

function briefing(req: LanguageRequest): StrategistResponse {
  const ex = req.report.executive;
  const parts: string[] = [ex.statusReason];
  const rc = rootCauseLine(req);
  if (rc) parts.push(rc);
  if (req.weeklyPriority?.primary) parts.push(`This week's priority: ${req.weeklyPriority.primary.action}`);
  else if (ex.mostUrgentAction) parts.push(`First move: ${ex.mostUrgentAction.action}`);
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
  const wa = assessWithdrawalV2(req.snapshot, req.report.cash, amount);
  const VERDICT: Record<string, string> = {
    safe: `${egp(amount)} is affordable from verified cash with the reserve intact.`,
    safe_reduces_flexibility: `${egp(amount)} is affordable, but it thins your buffer noticeably.`,
    conditional: `${egp(amount)} works only if the expected money arrives on time — conditional, not verified.`,
    tight: `${egp(amount)} is possible but leaves you tight against the reserve.`,
    unsafe: `${egp(amount)} is not safely affordable — it breaks the reserve.`,
    unknowable: `Whether ${egp(amount)} is affordable cannot be verified yet.`,
  };
  const kv: [string, string][] = [
    ["Verified cash", wa.verifiedCash], ["Expected money", wa.expectedMoney],
    ["Committed", wa.committed], ["Reserve", wa.reserve],
    ["Headroom", wa.verifiedHeadroom], ["After this draw", wa.resultingReserve],
    ["Profit context", wa.profitContext], ["Already withdrawn", wa.withdrawalsAlready],
    ["Freshness", wa.dataFreshness],
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
      ? (amount <= wa.recommendedMax ? `Proceed — and record it as a withdrawal so cash stays honest.` : `Cap this draw at ${egp(wa.recommendedMax)} — ${wa.nextStep}`)
      : wa.nextStep,
    expectedImpact: wa.recommendedMax != null ? `keeps the reserve intact` : "unlocks cash verification",
    urgency: "today", confidence: wa.confidence,
    missingData: wa.verdict === "unknowable" ? ["fresh physical cash count"] : [],
  };
  return {
    mode: req.mode, headline: VERDICT[wa.verdict],
    conclusion: wa.reasonsToWait.length ? `Before deciding: ${wa.reasonsToWait.join(" ")}` : "No blockers found in the current books.",
    priorities: [p], contradictions: [],
    dataLimitations: req.report.dataQuality.slice(0, 2).map((d) => d.title),
    suggestedQuestions: [],
  };
}

function affordabilityAnswer(req: LanguageRequest, r: Parameters<typeof assessAffordability>[2]): StrategistResponse {
  const a = assessAffordability(req.snapshot, req.report.cash, r);
  const VERDICT: Record<string, string> = {
    safe: "Affordable from verified cash.", safe_reduces_flexibility: "Affordable, but it thins the buffer.",
    conditional: "Only affordable if the expected money arrives — conditional.", tight: "Possible but tight against the reserve.",
    unsafe: "Not safely affordable.", unknowable: "Cannot be verified yet.",
  };
  return {
    mode: req.mode,
    headline: `${r.label ?? r.kind}: ${VERDICT[a.verdict]}`,
    conclusion: [
      `Verified cash: ${a.verifiedCash != null ? egp(a.verifiedCash) : "unknown (no fresh count)"}.`,
      `Expected (not available): ${a.expectedUnavailable != null ? `~${egp(a.expectedUnavailable)}` : "—"}.`,
      `Committed 30d: ${egp(a.committed30)}. Reserve: ${egp(a.requiredReserve)}.`,
      a.recurring ? `Recurring: ${egp(a.recurring.monthly)}/month${a.recurring.revenueToCover != null ? ` → needs ~${egp(a.recurring.revenueToCover)}/month extra sales ${a.recurring.marginBasis}` : ""}.` : "",
      ...a.reasons.map((x) => x + "."),
    ].filter(Boolean).join(" "),
    priorities: req.report.findings.filter((f) => ["cash-count-required", "reserve-breach-risk", "withdrawals-high"].includes(f.id)).slice(0, 2).map(findingToPriority),
    contradictions: [],
    dataLimitations: [...a.missing, ...a.assumptions],
    suggestedQuestions: ["How much can I safely withdraw this month?", "What obligations are coming?"],
  };
}

/** intent → the findings that answer it (supported deterministic questions) */
const INTENTS: { match: RegExp; ids?: string[]; classes?: Finding["class"][]; headline: string }[] = [
  { match: /margin|هامش|profit.*(fall|drop|weak)|ربح/i, ids: ["margin-drop", "growth-weaker-economics", "uncovered-revenue", "missing-costs"], headline: "What the engine knows about margin" },
  { match: /cash|كاش|نقد|drawer|where.*money|فلوسي/i, ids: ["profit-up-cash-low", "cash-not-tracked", "cash-count-required", "cash-count-stale", "withdrawals-high", "reserve-breach-risk", "cheque-concentration"], headline: "What the engine knows about cash" },
  { match: /obligation|due|upcoming|التزام|مستحق/i, ids: ["obligations-unfunded", "reserve-breach-risk"], headline: "What's coming due" },
  { match: /runway|how long|survive|last|tight|هيكفي/i, ids: ["reserve-breach-risk", "obligations-unfunded", "cash-count-required"], headline: "How long the cash lasts" },
  { match: /cheque|شيك|settle|mall/i, ids: ["overdue-cheques", "settlement-lag"], headline: "Where the settlement cycle stands" },
  { match: /stock|مخزون|restock|inventory/i, ids: ["stock-risk", "inventory-not-tracked"], headline: "Where stock stands" },
  { match: /fix|أصلح|first|priorit|week|matters/i, classes: ["contradiction", "decision_risk", "warning", "data_quality"], headline: "What to fix first" },
  { match: /improv|better|grow|بتتحسن|أحسن/i, ids: ["revenue-up", "revenue-down", "margin-gain", "margin-drop", "behind-target", "growth-weaker-economics"], headline: "Is the business improving" },
  { match: /product|منتج|sell|shelf/i, classes: ["opportunity"], headline: "Product economics" },
  { match: /missing|ناقص|data|information/i, classes: ["data_quality"], headline: "What data is missing" },
];

function answerQuestion(req: LanguageRequest): StrategistResponse {
  const q = req.question ?? "";
  // affordability: purchases and hires route to the affordability engine
  const buy = /(?:buy|purchase|اشتري|شراء).*?([\d,.]+)\s*(k|K)?|([\d,.]+)\s*(k|K)?\s*(?:EGP|جنيه).*?(?:stock|بضاعة|مخزون)/i.exec(q);
  if (buy) {
    const raw = (buy[1] ?? buy[3] ?? "").replace(/[,،]/g, "");
    let amt = Number(raw);
    if (buy[2] || buy[4]) amt *= 1000;
    if (Number.isFinite(amt) && amt > 0) return affordabilityAnswer(req, { kind: "purchase", upfront: amt, mandatory: false, label: "stock purchase" });
  }
  const hire = /(?:employee|hire|موظف|عامل).*?([\d,.]+)\s*(k|K)?|afford.*(?:employee|موظف)/i.exec(q);
  if (hire) {
    const raw = (hire[1] ?? "").replace(/[,،]/g, "");
    const sal = Number(raw);
    if (Number.isFinite(sal) && sal > 0) return affordabilityAnswer(req, { kind: "employee", upfront: 0, recurringMonthly: sal * (hire[2] ? 1000 : 1), mandatory: false, label: "new employee" });
    return affordabilityAnswer(req, { kind: "employee", upfront: 0, recurringMonthly: (req.snapshot.expenses.recurringMonthly.value ?? []).find((r) => /salary/i.test(r.name))?.avgMonthly ?? 6_000, mandatory: false, label: "new employee (salary assumed = current salary pattern; give a number for precision)" });
  }

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
      const extras: string[] = [];
      if (/margin|هامش|ربح/i.test(q)) {
        const d = req.report.decomposition;
        if (d.available) extras.push(`Decomposition of the gross-profit change: volume ${egp(d.volumeEffect)}, price ${egp(d.priceEffect)}, mix ${egp(d.mixEffect)}, cost ${egp(d.costEffect)}, unexplained ${egp(d.residual)} (coverage ${d.coverage}%).`);
        else if (d.reason) extras.push(`Volume/price/mix/cost split unavailable: ${d.reason}.`);
        const pc = req.report.profitContribution;
        if (pc.available && pc.negative.length) extras.push(`Biggest profit drags: ${pc.negative.slice(0, 3).map((x) => `${x.name} (−${egp(Math.abs(x.delta))})`).join(", ")}.`);
      }
      const rc = rootCauseLine(req);
      if (/revenue|sales|drop|بتتحسن|improving/i.test(q) && rc) extras.push(rc);
      return base(req, intent.headline,
        [`Deterministic answer from the current books (${req.report.period}). Each item links to its evidence.`, ...extras].join(" "),
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
      case "product_strategy": {
        const r = req.report;
        const resp = byClasses(req, ["opportunity"], ["growth-driver", "decline-driver", "stock-risk", "missing-costs"], "Product economics — deterministic view");
        const bits: string[] = [];
        if (r.portfolio.available) {
          const stars = r.portfolio.classifications.filter((c) => c.tags.includes("star")).map((c) => c.name);
          const fix = r.portfolio.classifications.filter((c) => c.tags.includes("review_pricing")).map((c) => c.name);
          const grow = r.shelf.filter((x) => x.verdict === "expand_consideration").slice(0, 3).map((x) => x.name);
          if (stars.length) bits.push(`Carrying the portfolio: ${stars.slice(0, 4).join(", ")}.`);
          if (fix.length) bits.push(`Pricing review queue: ${fix.slice(0, 4).join(", ")} (below your margin floor).`);
          if (grow.length) bits.push(`Shelf-space review (relative priority — no shelf dimensions recorded): ${grow.join(", ")}.`);
          if (r.purchaseReviews.length) bits.push(`Purchase review: ${r.purchaseReviews.slice(0, 3).map((x) => `${x.name} — ${x.kind === "no_stock_position" ? "record a count first" : x.why}`).join(" · ")}.`);
        } else if (r.portfolio.reason) {
          bits.push(`Portfolio classification unavailable: ${r.portfolio.reason}.`);
        }
        return { ...resp, conclusion: [resp.conclusion, ...bits].join(" ") };
      }
      case "cash_review": {
        const cash = req.report.cash;
        const run = req.report.runway;
        const resp = byClasses(req, [], ["profit-up-cash-low", "cash-not-tracked", "cash-count-required", "cash-count-stale", "withdrawals-high", "reserve-breach-risk", "obligations-unfunded"], "Where your money is — deterministic view");
        const bits = [
          `AVAILABLE: ${cash.available.note}.`,
          `EXPECTED (not available): ${cash.expected.openSettlementNet != null ? `~${egp(cash.expected.openSettlementNet)} in the settlement pipe${cash.expected.nextChequeEta ? `, ETA ~${cash.expected.nextChequeEta}` : ""}` : "no measurable settlement pipe"}.`,
          `COMMITTED (30d): ${egp(cash.committed.next30)}${cash.committed.items[0] ? ` (${cash.committed.items.slice(0, 3).map((o) => o.name).join(", ")})` : ""}.`,
          `RESERVE: ${egp(cash.safety.requiredReserve)} — ${cash.safety.reserveBasis}.`,
          cash.safety.verifiedHeadroom != null ? `HEADROOM: ${egp(cash.safety.verifiedHeadroom)} verified.` : `HEADROOM: unknowable — ${cash.safety.blockers[0] ?? "data missing"}.`,
          run.available && run.verifiedCoverageMonths != null ? `Verified cash covers ~${run.verifiedCoverageMonths} months of operating costs.` : "",
        ].filter(Boolean);
        return { ...resp, conclusion: bits.join(" ") };
      }
      case "cheque_review":
        return byClasses(req, [], ["overdue-cheques", "settlement-lag"], "Settlement & cheque review");
      case "data_quality_review":
        return byClasses(req, ["data_quality"], [], "Data quality — what's missing and what it distorts");
    }
  }
}

export const deterministicProvider = new DeterministicProvider();
