/** Deterministic operational answers — PURE Layer 2 (Cycle 9, Phase 20).
 *
 *  Extends zero-provider mode: BostaOS answers the everyday operational
 *  questions with NO external model, purely by rendering canonical engine data.
 *  It never explains beyond the evidence it was handed. */
import type { DailyBrief } from "./brief";
import type { CloseEvaluation } from "./daily-close";

export type OperationalIntent =
  | "incomplete_today" | "why_cant_close" | "cash_difference_cause" | "stock_variance_cause"
  | "missing_records" | "changed_after_correction" | "overdue_action" | "yesterday_trustworthy"
  | "before_leaving" | "ready_for_activation" | "check_first_tomorrow";

export interface OperationalAnswerCtx {
  brief: DailyBrief;
  exceptions: { title: string; detail: string; resolutionAction: string; type: string; screenLink: string }[];
  close: CloseEvaluation | null;
  activationReadiness: string;
  activationNext: { title: string; action: string; screenLink: string } | null;
  cashDifferenceCandidates: { label: string; suggestedAction: string }[];
  stockVariances: { name: string; note: string }[];
  overdueActions: { title: string; screenLink: string }[];
  staleCloses: { date: string }[];
}

export interface OperationalAnswer {
  intent: OperationalIntent;
  headline: string;
  points: string[];
  screenLink: string | null;
  grounded: true;                 // this answer is 100% deterministic
}

const INTENT_PATTERNS: [OperationalIntent, RegExp][] = [
  ["why_cant_close", /why.*(can.?t|cannot).*(close|complete)|blocked.*close/i],
  ["incomplete_today", /(what.?s|what is).*(incomplete|left|remaining|outstanding)|incomplete today/i],
  ["cash_difference_cause", /(cash|drawer).*(difference|short|over|discrepan)|caused.*cash/i],
  ["stock_variance_cause", /(stock|inventory).*(variance|difference|short|missing)|caused.*stock/i],
  ["missing_records", /(what|which).*(records?|data).*(missing|incomplete)|missing data/i],
  ["changed_after_correction", /(changed|stale).*(correct|edit)|after.*correct/i],
  ["overdue_action", /(which|what).*action.*(overdue|late)|overdue action/i],
  ["yesterday_trustworthy", /(is )?yesterday.*(trust|reliable|complete|good)/i],
  ["before_leaving", /(before|end of day).*(leav|clos|go home)|what.*before.*leav/i],
  ["ready_for_activation", /(ready|prepared).*(activat|go live|live)|activation ready/i],
  ["check_first_tomorrow", /(check|do).*(first|tomorrow|morning)|start of day/i],
];

/** Route free text to an operational intent, or null when it isn't one. */
export function detectOperationalIntent(text: string): OperationalIntent | null {
  for (const [intent, re] of INTENT_PATTERNS) if (re.test(text)) return intent;
  return null;
}

export function answerOperationalQuestion(intent: OperationalIntent, c: OperationalAnswerCtx): OperationalAnswer {
  const base = { intent, grounded: true as const };
  switch (intent) {
    case "why_cant_close":
    case "incomplete_today": {
      if (!c.close) return { ...base, headline: "No close is in progress for a recent day.", points: ["Open the daily close to evaluate the most recent trading day."], screenLink: "/health" };
      if (c.close.canComplete) return { ...base, headline: "Nothing is blocking the close — it's ready to complete.", points: c.close.autoComplete.slice(0, 4).map((i) => `✓ ${i.label}`), screenLink: "/health" };
      const blockers = [...c.close.blocked, ...c.close.unresolved, ...c.close.confirmRequired.filter((i) => i.required)];
      return { ...base, headline: c.close.blockReason ?? "Some items are unmet.", points: blockers.map((b) => `• ${b.label} — ${b.detail}`), screenLink: "/health" };
    }
    case "cash_difference_cause": {
      if (!c.cashDifferenceCandidates.length) return { ...base, headline: "No open cash difference to explain.", points: ["Cash reconciles, or no live count exists yet."], screenLink: "/money" };
      return { ...base, headline: "Most likely explanations for the cash difference (neutral — never assumed loss):", points: c.cashDifferenceCandidates.map((x) => `• ${x.label} — ${x.suggestedAction}`), screenLink: "/money" };
    }
    case "stock_variance_cause": {
      if (!c.stockVariances.length) return { ...base, headline: "No open stock variance to explain.", points: ["Stock reconciles, or no count exists yet."], screenLink: "/settings/opening" };
      return { ...base, headline: "Stock variance candidates (never assumed theft):", points: c.stockVariances.map((v) => `• ${v.name}: ${v.note}`), screenLink: "/settings/opening" };
    }
    case "missing_records": {
      const miss = c.brief.trust.missing;
      if (!miss.length) return { ...base, headline: "No missing records flagged right now.", points: [], screenLink: null };
      return { ...base, headline: "Records that would improve confidence:", points: miss.map((m) => `• ${m}`), screenLink: "/health" };
    }
    case "changed_after_correction": {
      if (!c.staleCloses.length) return { ...base, headline: "No completed close has gone stale.", points: ["Corrections you made didn't affect any already-completed day."], screenLink: "/health" };
      return { ...base, headline: "These completed closes changed after they were closed:", points: c.staleCloses.map((s) => `• ${s.date} — reopen and re-close to keep the record accurate.`), screenLink: "/health" };
    }
    case "overdue_action": {
      if (!c.overdueActions.length) return { ...base, headline: "No accepted action is overdue.", points: [], screenLink: null };
      return { ...base, headline: "Overdue accepted action(s):", points: c.overdueActions.map((a) => `• ${a.title}`), screenLink: c.overdueActions[0].screenLink };
    }
    case "yesterday_trustworthy": {
      return { ...base, headline: c.brief.yesterday.complete ? "Yesterday looks complete." : "Yesterday is not fully complete yet.", points: [...c.brief.yesterday.lines, ...c.brief.trust.lines.slice(0, 2)], screenLink: "/health" };
    }
    case "before_leaving": {
      const req = c.brief.today.lines.filter((l) => /record:/i.test(l));
      const pts = [...(req.length ? req : ["No required records outstanding — enter today's activity."])];
      if (c.close && !c.close.canComplete) pts.push(`Then run the daily close: ${c.close.blockReason ?? "resolve the open items."}`);
      else pts.push("Then run the daily close to lock the day.");
      return { ...base, headline: "Before you leave the store:", points: pts, screenLink: "/health" };
    }
    case "ready_for_activation": {
      const ready = c.activationReadiness === "live_operational" || c.activationReadiness === "live_verified";
      return { ...base, headline: ready ? "BostaOS is live and operational." : "Not fully activated yet.", points: c.activationNext ? [`Next: ${c.activationNext.title} — ${c.activationNext.action}`] : ["All required activation steps are done."], screenLink: c.activationNext?.screenLink ?? "/health" };
    }
    case "check_first_tomorrow": {
      const pts: string[] = [];
      if (c.brief.today.primaryAction) pts.push(`Primary: ${c.brief.today.primaryAction.title} — ${c.brief.today.primaryAction.action}`);
      for (const e of c.exceptions.slice(0, 3)) pts.push(`• ${e.title} — ${e.resolutionAction}`);
      if (!pts.length) pts.push("Nothing outstanding — record the day as it happens.");
      return { ...base, headline: "First things to check tomorrow:", points: pts, screenLink: "/health" };
    }
  }
}
