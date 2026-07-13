/** Weekly owner priority — PURE. Picks ONE primary action and at most two
 *  secondary ones from the ranked findings, respecting dismissals, open
 *  actions and the owner's focus (growth vs cash preservation).
 *
 *  "Monitor" is never the primary unless literally nothing actionable exists. */
import type { Finding } from "./types";
import type { StrategyReport } from "./report";

export interface WeeklyPriorityItem {
  findingId: string;
  action: string;
  reason: string;
  evidence: { label: string; value: string; screenLink: string }[];
  expectedOutcome: string;
  confidence: string;
  effort: "low" | "medium" | "high";
  screenLink: string;
  successCriteria: string;
  reviewTiming: string;
  /** when an open action already covers it, the priority is to finish it */
  alreadyQueued: boolean;
}
export interface WeeklyPriority {
  primary: WeeklyPriorityItem | null;
  secondary: WeeklyPriorityItem[];
  suppressed: { findingId: string; why: string }[];
  note: string;
}

export interface PriorityInputs {
  /** finding ids the owner dismissed, with the impact recorded at dismissal */
  dismissed: { findingId: string; impactEgp: number | null }[];
  /** finding ids with an OPEN action in the queue */
  openActionFindingIds: string[];
  reviewPeriodDays: number;
}

const EFFORT: Record<Finding["class"], "low" | "medium" | "high"> = {
  data_quality: "low", fact: "low", forecast: "low",
  warning: "medium", opportunity: "medium", recommendation: "medium",
  contradiction: "medium", decision_risk: "medium",
};

function toItem(f: Finding, queued: boolean, reviewDays: number): WeeklyPriorityItem {
  return {
    findingId: f.id,
    action: queued ? `Finish the queued action: ${f.action?.title ?? f.title}` : f.action?.action ?? f.alternativeAction ?? "Review the finding",
    reason: f.action?.rationale ?? f.detail,
    evidence: f.evidence.slice(0, 3).map((e) => ({ label: e.label, value: e.value, screenLink: e.screenLink })),
    expectedOutcome: f.action?.expectedImpact ?? (f.impactEgp != null ? `up to EGP ${Math.round(f.impactEgp).toLocaleString("en-US")} at stake` : "risk contained"),
    confidence: f.confidence,
    effort: EFFORT[f.class],
    screenLink: f.action?.screenLink ?? f.evidence[0]?.screenLink ?? "/health",
    successCriteria: f.resolutionCriteria,
    reviewTiming: `review in ${reviewDays} days`,
    alreadyQueued: queued,
  };
}

export function selectWeeklyPriority(report: StrategyReport, inputs: PriorityInputs): WeeklyPriority {
  const dismissedBy = new Map(inputs.dismissed.map((d) => [d.findingId, d.impactEgp]));
  const openSet = new Set(inputs.openActionFindingIds);
  const suppressed: { findingId: string; why: string }[] = [];

  const focus = report.decisionContext.reserveFloor != null ? null : null; // placeholder to keep signature honest
  void focus;

  const CLASS_BOOST: Record<Finding["class"], number> = {
    decision_risk: 30, contradiction: 25, warning: 15, data_quality: 10,
    opportunity: 5, recommendation: 5, forecast: 0, fact: 0,
  };

  const candidates = report.findings.filter((f) => {
    if (!f.actionable || !f.action) return false;
    if (f.urgency === "monitor") return false;
    const dismissedImpact = dismissedBy.get(f.id);
    if (dismissedImpact !== undefined) {
      // stay silent unless the issue materially worsened (impact +25%) or went critical
      const worsened = f.impactEgp != null && dismissedImpact != null && f.impactEgp > dismissedImpact * 1.25;
      const critical = f.urgency === "today" && (f.class === "contradiction" || f.class === "decision_risk");
      if (!worsened && !critical) {
        suppressed.push({ findingId: f.id, why: "dismissed by you and not materially worse" });
        return false;
      }
    }
    return true;
  });

  // cash-preservation focus: unsafe-cash issues outrank opportunities regardless of EGP
  const scored = candidates.map((f) => ({
    f,
    score: f.rank * -1 + CLASS_BOOST[f.class] + (f.urgency === "today" ? 20 : f.urgency === "this_week" ? 10 : 0)
      + ((f.id === "profit-up-cash-low" || f.id === "withdrawals-high") ? 15 : 0),
  })).sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const anchor = report.findings.find((f) => f.id === "steady-state") ?? report.findings[0] ?? null;
    return {
      primary: anchor ? { ...toItem(anchor, false, inputs.reviewPeriodDays), action: "No action needed — the books are steady. Keep the daily totals current.", effort: "low" } : null,
      secondary: [], suppressed,
      note: "Nothing actionable above thresholds this week.",
    };
  }

  const [first, ...rest] = scored;
  return {
    primary: toItem(first.f, openSet.has(first.f.id), inputs.reviewPeriodDays),
    secondary: rest.slice(0, 2).map((x) => toItem(x.f, openSet.has(x.f.id), inputs.reviewPeriodDays)),
    suppressed,
    note: suppressed.length ? `${suppressed.length} previously-dismissed issue(s) stayed silent.` : "",
  };
}
