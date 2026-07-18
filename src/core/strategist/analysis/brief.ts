/** Daily owner brief — PURE Layer 2 (Cycle 9).
 *
 *  A deterministic answer to the questions an owner asks at the start and end
 *  of a day: was yesterday complete, what happened, what needs attention today,
 *  is cash reconciled, is stock trustworthy, which cheque matters, what is the
 *  single most important action, what is still missing, is BostaOS healthy.
 *
 *  Generated entirely from records. The language layer may rephrase the prose,
 *  but it can never change a number, a priority or the recommended action —
 *  those are fixed here. */

export type Confidence3 = "high" | "medium" | "low";
export type ConfidenceN = Confidence3 | "none";

export interface BriefInput {
  today: string;
  lastDataDate: string | null;
  staleDays: number | null;
  isStale: boolean;
  /** the most recent recorded trading day, if any */
  lastDay: { date: string; revenue: number; expenses: number; grossProfit: number | null; grossProfitCovered: boolean; topProduct: string | null } | null;
  /** close status for the most recent recorded day */
  lastDayClose: "complete" | "estimated" | "partial" | "no_trading" | "reopened" | "open";
  cashReconciled: boolean | null;      // null = cannot tell (no live data)
  cashConfidence: ConfidenceN;
  inventoryConfidence: ConfidenceN;
  financialConfidence: Confidence3;
  nextChequeEta: string | null;
  overdueCheques: string[];
  obligationsNext7: number;
  requiredRecordsToday: string[];      // e.g. "record today's sales", "count the drawer"
  exceptions: { critical: number; high: number; total: number; top: { title: string; screenLink: string } | null };
  primaryAction: { title: string; action: string; screenLink: string } | null;
  secondaryActions: { title: string; screenLink: string }[];
  missing: string[];
  readiness: string;                   // activation readiness state
}

export type OperationalHealth = "healthy" | "attention" | "critical" | "activating" | "stale";

export interface DailyBrief {
  date: string;
  health: OperationalHealth;
  headline: string;
  yesterday: {
    date: string | null;
    complete: boolean;
    lines: string[];
    exceptions: number;
    /** the raw figures, so the UI can lay them out as data instead of prose */
    stats: {
      revenue: number | null;
      expenses: number | null;
      grossProfit: number | null;
      grossProfitCovered: boolean;
      topProduct: string | null;
      closeStatus: string;
    };
  };
  today: {
    lines: string[];
    primaryAction: { title: string; action: string; screenLink: string } | null;
    secondaryActions: { title: string; screenLink: string }[];
  };
  trust: {
    cash: ConfidenceN;
    inventory: ConfidenceN;
    financial: Confidence3;
    cashReconciled: boolean | null;
    staleData: string | null;
    missing: string[];
    lines: string[];
  };
}

const egp = (n: number) => `${Math.round(n).toLocaleString()} EGP`;

export function composeDailyBrief(i: BriefInput): DailyBrief {
  // ── health verdict ─────────────────────────────────────────────────────
  let health: OperationalHealth;
  if (i.readiness === "historical_only" || i.readiness === "activation_incomplete") health = "activating";
  else if (i.exceptions.critical > 0) health = "critical";
  else if (i.isStale) health = "stale";
  else if (i.exceptions.high > 0) health = "attention";
  else health = "healthy";

  // ── yesterday ──────────────────────────────────────────────────────────
  const yLines: string[] = [];
  const complete = i.lastDayClose === "complete" || i.lastDayClose === "estimated" || i.lastDayClose === "no_trading";
  if (i.lastDay) {
    if (i.lastDayClose === "no_trading") yLines.push(`${i.lastDay.date}: marked no-trading.`);
    else {
      yLines.push(`Revenue ${egp(i.lastDay.revenue)}${i.lastDayClose === "estimated" ? " (estimated)" : ""}.`);
      if (i.lastDay.grossProfit != null && i.lastDay.grossProfitCovered) yLines.push(`Gross profit ${egp(i.lastDay.grossProfit)}.`);
      else yLines.push("Gross profit withheld — some sold lines lack cost.");
      yLines.push(`Expenses ${egp(i.lastDay.expenses)}.`);
      if (i.lastDay.topProduct) yLines.push(`Top seller: ${i.lastDay.topProduct}.`);
    }
    yLines.push(`Close status: ${i.lastDayClose}.`);
  } else {
    yLines.push("No recent trading day on record.");
  }

  // ── today ──────────────────────────────────────────────────────────────
  const tLines: string[] = [];
  if (i.obligationsNext7 > 0) tLines.push(`${egp(i.obligationsNext7)} of obligations due in the next 7 days.`);
  if (i.overdueCheques.length) tLines.push(`Cheque attention: ${i.overdueCheques.join(", ")} overdue.`);
  else if (i.nextChequeEta) tLines.push(`Next cheque expected around ${i.nextChequeEta}.`);
  for (const r of i.requiredRecordsToday) tLines.push(`Record: ${r}.`);
  if (i.exceptions.total > 0) tLines.push(`${i.exceptions.total} open operational exception(s)${i.exceptions.critical ? `, ${i.exceptions.critical} critical` : ""}.`);
  if (!tLines.length) tLines.push("Nothing outstanding — record today's activity as it happens.");

  // ── trust ──────────────────────────────────────────────────────────────
  const trustLines: string[] = [];
  trustLines.push(`Cash: ${i.cashReconciled == null ? "not yet verifiable (no live count)" : i.cashReconciled ? "reconciled" : "a difference is open"} · confidence ${i.cashConfidence}.`);
  trustLines.push(`Inventory: confidence ${i.inventoryConfidence}${i.inventoryConfidence === "none" ? " (no stock count yet)" : ""}.`);
  trustLines.push(`Financial coverage: ${i.financialConfidence}.`);
  const staleData = i.isStale && i.staleDays != null ? `Books are ${i.staleDays} days stale (last data ${i.lastDataDate}).` : null;
  if (staleData) trustLines.push(staleData);

  // ── headline ───────────────────────────────────────────────────────────
  const headline =
    health === "activating" ? "BostaOS is still activating — finish the setup steps to unlock live answers."
      : health === "critical" ? `${i.exceptions.critical} critical issue(s) need attention today.`
        : health === "stale" ? `Books are ${i.staleDays ?? "several"} days behind — bring sales current.`
          : health === "attention" ? (i.primaryAction ? i.primaryAction.title : "A few things need attention this week.")
            : "Operationally healthy — nothing urgent.";

  return {
    date: i.today,
    health,
    headline,
    yesterday: {
      date: i.lastDay?.date ?? i.lastDataDate, complete, lines: yLines, exceptions: i.exceptions.total,
      stats: {
        revenue: i.lastDay?.revenue ?? null,
        expenses: i.lastDay?.expenses ?? null,
        grossProfit: i.lastDay?.grossProfit ?? null,
        grossProfitCovered: i.lastDay?.grossProfitCovered ?? false,
        topProduct: i.lastDay?.topProduct ?? null,
        closeStatus: i.lastDayClose,
      },
    },
    today: { lines: tLines, primaryAction: i.primaryAction, secondaryActions: i.secondaryActions },
    trust: {
      cash: i.cashConfidence, inventory: i.inventoryConfidence, financial: i.financialConfidence,
      cashReconciled: i.cashReconciled, staleData, missing: i.missing, lines: trustLines,
    },
  };
}
