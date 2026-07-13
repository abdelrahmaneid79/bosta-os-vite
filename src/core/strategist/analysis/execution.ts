/** Recommendation execution tracking — PURE Layer 2 (Cycle 9).
 *
 *  Measures whether accepted recommendations are actually followed and whether
 *  the outcome can be attributed to the action. Attribution is deliberately
 *  cautious: correlation is never asserted as cause, and a labelled strength
 *  makes the uncertainty explicit. */

export type Attribution = "strong" | "moderate" | "weak" | "inconclusive";

export interface OutcomeInput {
  actionCompleted: boolean;
  improved: boolean;              // the tracked metric moved the desired way
  coverageOk: boolean;            // the metric is trustworthy (e.g. COGS coverage)
  magnitudePct: number | null;    // size of the move, when known
  concurrentChanges: number;      // other plausible drivers in the same window
}

/** Label how confidently an outcome can be attributed to the action. */
export function classifyAttribution(i: OutcomeInput): { attribution: Attribution; note: string } {
  if (!i.coverageOk) return { attribution: "inconclusive", note: "The tracked metric isn't trustworthy enough (data coverage) to attribute an outcome." };
  if (!i.actionCompleted && i.improved) return { attribution: "weak", note: "The metric improved but the action wasn't completed — the change isn't attributable to it." };
  if (!i.actionCompleted) return { attribution: "inconclusive", note: "The action wasn't completed, so there is nothing to attribute." };
  if (!i.improved) return { attribution: "weak", note: "The action was completed but the metric didn't move the desired way." };
  const big = (i.magnitudePct ?? 0) >= 5;
  if (i.concurrentChanges <= 1 && big) return { attribution: "strong", note: "Action completed, metric moved clearly, and few other drivers changed at once." };
  if (i.concurrentChanges <= 2) return { attribution: "moderate", note: "Action completed and the metric improved, but other changes overlapped — attribution is partial." };
  return { attribution: "weak", note: "The metric improved, but many things changed at once — attribution is weak." };
}

export interface ActionHistoryItem {
  status: string;                 // suggested | accepted | in_progress | completed | dismissed
  acceptedAt: string | null;
  completedAt: string | null;
  reviewOverdue: boolean;
  issueStillOpen: boolean;        // the linked exception/finding is still live
}

export interface ExecutionSummary {
  total: number;
  completionRate: number;         // completed / (accepted or beyond)
  oftenIgnored: boolean;          // many accepted but not started/completed
  overdue: number;
  quickWins: number;              // completed within a few days of acceptance
  completedButUnresolved: number; // completed yet the issue persists
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Roll up execution history into signals the ranker can lean on. */
export function summarizeExecution(items: ActionHistoryItem[]): ExecutionSummary {
  const engaged = items.filter((i) => i.status !== "suggested");
  const completed = items.filter((i) => i.status === "completed");
  const overdue = items.filter((i) => i.reviewOverdue && i.status !== "completed").length;
  const quickWins = completed.filter((i) => i.acceptedAt && i.completedAt && daysBetween(i.acceptedAt, i.completedAt) <= 3).length;
  const completedButUnresolved = completed.filter((i) => i.issueStillOpen).length;
  const completionRate = engaged.length ? Math.round((completed.length / engaged.length) * 100) : 0;
  const oftenIgnored = engaged.length >= 3 && completionRate < 34;
  return { total: items.length, completionRate, oftenIgnored, overdue, quickWins, completedButUnresolved };
}
