/** StrategyReport — the complete deterministic interpretation of a snapshot.
 *  PURE. This is what the UI renders and what language providers explain;
 *  neither is allowed to re-derive any of it. */
import type { StrategistSnapshot } from "../contract";
import type { Finding, FindingConfidence } from "./types";
import { analyzeSnapshot } from "./engine";
import { computeDecisionContext, type DecisionContext } from "./decision";
import {
  analyzeContribution, decomposeChange, classifyPortfolio, shelfPriorities,
  pricingReviews, purchaseReviews,
  type ContributionAnalysis, type Decomposition, type PortfolioAnalysis,
  type ShelfPriority, type PricingReview, type PurchaseReview,
} from "./products";
import { buildObligationCalendar, composeCashState, cashFindings, type CashState, type ObligationCalendar, type AcceptedCommitment } from "./cash";
import { projectCash, computeRunway, type CashProjection, type RunwayResult } from "./forecast-cash";

export type BusinessStatus = "healthy" | "attention" | "critical" | "insufficient_data";

export interface ExecutiveState {
  status: BusinessStatus;
  statusReason: string;
  /** the single most important finding (rank 1) */
  headline: Finding | null;
  topRisk: Finding | null;
  topOpportunity: Finding | null;
  topDataIssue: Finding | null;
  mostUrgentAction: { findingId: string; title: string; action: string; screenLink: string } | null;
}

export interface StrategyReport {
  period: string;
  comparePeriod: string;
  freshness: { lastDataDate: string | null; staleDays: number | null; isStale: boolean; completenessScore: number };
  executive: ExecutiveState;
  findings: Finding[];            // ranked
  contradictions: Finding[];      // subset, convenience
  dataQuality: Finding[];         // subset, convenience
  decisionContext: DecisionContext;
  /** Cycle 6 — root-cause & product intelligence (all deterministic) */
  revenueContribution: ContributionAnalysis;
  profitContribution: ContributionAnalysis;
  decomposition: Decomposition;
  portfolio: PortfolioAnalysis;
  shelf: ShelfPriority[];
  pricingReviews: PricingReview[];
  purchaseReviews: PurchaseReview[];
  /** Cycle 7 — cash intelligence (deterministic, never one collapsed balance) */
  cash: CashState;
  obligations: ObligationCalendar;
  cashProjection: CashProjection;
  runway: RunwayResult;
  /** the highest confidence ANY consumer may claim about this report */
  maxConfidence: FindingConfidence;
}

const CONF_ORDER: FindingConfidence[] = ["low", "medium", "high"];

export function buildStrategyReport(s: StrategistSnapshot, accepted: AcceptedCommitment[] = []): StrategyReport {
  const obligations = buildObligationCalendar(s, accepted);
  const cash = composeCashState(s, obligations);
  const findings = analyzeSnapshot(s, cashFindings(s, cash, obligations));
  const portfolio = classifyPortfolio(s);

  const risky = (f: Finding) => f.class === "warning" || f.class === "contradiction" || f.class === "decision_risk";
  const topRisk = findings.find(risky) ?? null;
  const topOpportunity = findings.find((f) => f.class === "opportunity") ?? null;
  const topDataIssue = findings.find((f) => f.class === "data_quality") ?? null;
  const urgent = findings.find((f) => f.action && (f.urgency === "today" || f.urgency === "this_week"));

  const criticalNow = findings.some((f) => risky(f) && f.urgency === "today");
  const onlyDataQuality = findings.length > 0 && findings.every((f) => f.class === "data_quality" || f.class === "fact");
  let status: BusinessStatus;
  let statusReason: string;
  if (s.meta.completenessScore < 40 && onlyDataQuality) {
    status = "insufficient_data";
    statusReason = `Data completeness is ${s.meta.completenessScore}/100 — the engine can describe gaps, not performance.`;
  } else if (criticalNow) {
    status = "critical";
    statusReason = "At least one high-urgency risk or contradiction needs attention today.";
  } else if (topRisk) {
    status = "attention";
    statusReason = `${findings.filter(risky).length} open risk(s)/contradiction(s), none requiring action today.`;
  } else {
    status = "healthy";
    statusReason = "No risks or contradictions above the reporting thresholds.";
  }

  // the report's confidence ceiling = the strongest confidence the engine
  // could establish, degraded when overall completeness is poor
  const best = findings.reduce<FindingConfidence>((acc, f) =>
    CONF_ORDER.indexOf(f.confidence) > CONF_ORDER.indexOf(acc) ? f.confidence : acc, "low");
  const maxConfidence: FindingConfidence = s.meta.completenessScore < 50 && best === "high" ? "medium" : best;

  return {
    period: s.meta.period.label,
    comparePeriod: s.meta.comparePeriod.label,
    freshness: {
      lastDataDate: s.meta.lastDataDate,
      staleDays: s.meta.staleDays,
      isStale: s.meta.isStale,
      completenessScore: s.meta.completenessScore,
    },
    executive: {
      status, statusReason,
      headline: findings[0] ?? null,
      topRisk, topOpportunity, topDataIssue,
      mostUrgentAction: urgent && urgent.action
        ? { findingId: urgent.id, title: urgent.action.title, action: urgent.action.action, screenLink: urgent.action.screenLink }
        : null,
    },
    findings,
    contradictions: findings.filter((f) => f.class === "contradiction"),
    dataQuality: findings.filter((f) => f.class === "data_quality"),
    decisionContext: computeDecisionContext(s),
    revenueContribution: analyzeContribution(s, "revenue"),
    profitContribution: analyzeContribution(s, "grossProfit"),
    decomposition: decomposeChange(s),
    portfolio,
    shelf: shelfPriorities(portfolio),
    pricingReviews: pricingReviews(s),
    purchaseReviews: purchaseReviews(s),
    cash,
    obligations,
    cashProjection: projectCash(s, cash, obligations, 30),
    runway: computeRunway(s, cash),
    maxConfidence,
  };
}
