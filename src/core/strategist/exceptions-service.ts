/** Operational-exception service — Layer 2 orchestration (Cycle 9).
 *
 *  The SINGLE entry point every surface uses (Strategist, alert bell, daily
 *  brief, notifications, deterministic provider). It gathers the existing pure
 *  signals, composes the canonical exceptions, reconciles them with the
 *  persisted lifecycle, writes the lifecycle bookkeeping, and returns what the
 *  owner should see now. No detection logic lives here — only wiring. */
import { getRiskInsights } from "@/core/read/insights";
import { getMissingData } from "@/core/read/missing";
import { getPreviewedImportCount } from "@/core/read/imports";
import { getStaleCloses } from "@/core/read/daily-close";
import { getOverdueActions } from "./persistence/operations";
import { loadPersistedExceptions, syncExceptionLifecycle, metaFrom } from "./persistence/exceptions";
import {
  composeExceptions, reconcileLifecycle,
  type ExceptionInput, type ReconciledException,
} from "./analysis/exceptions";
import type { StrategistSnapshot } from "./contract";
import type { StrategyReport } from "./analysis/report";
import { todayCairo } from "@/core/time";

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Derive the snapshot/report-dependent signals (cash, inventory, cheques,
 *  obligations) for the exception input. Pure mapping — no fabrication. */
export function reportExceptionSignals(s: StrategistSnapshot, report: StrategyReport, today: string): Partial<ExceptionInput> {
  const lastCount = s.inventory.lastPhysicalCount.value;
  return {
    cash: {
      differenceUnresolved: s.cash.hasLiveData && (s.cash.unexplainedDifference.value ?? 0) !== 0,
      amount: s.cash.unexplainedDifference.value,
      countAgeDays: s.cash.countAgeDays.value,
      freshnessDays: s.context.cashCountFreshnessDays.value ?? 7,
    },
    inventory: {
      hasLiveData: s.inventory.hasLiveData,
      lastCountDate: lastCount,
      countAgeDays: lastCount ? daysBetween(lastCount, today) : null,
      staleDays: s.context.reviewPeriodDays.value ?? 30,
    },
    cheques: {
      overduePeriods: s.cheques.overduePeriods.value ?? [],
      unmatched: s.cheques.unmatchedCheques.value ?? 0,
    },
    obligationsOverdue: report.obligations.items
      .filter((o) => o.overdue)
      .map((o) => ({ title: o.name, amount: o.amount, dueDate: o.due.date ?? null })),
  };
}

export interface ExceptionRefresh {
  visible: ReconciledException[];
  autoResolvedIds: string[];
}

/** Compose → reconcile → persist. Returns the visible canonical exceptions. */
export async function refreshOperationalExceptions(ctx?: { snapshot?: StrategistSnapshot; report?: StrategyReport }): Promise<ExceptionRefresh> {
  const today = todayCairo();
  const now = new Date().toISOString();

  const [insights, missing, importsAwaitingApproval, staleCloses, actionsOverdue, persisted] = await Promise.all([
    getRiskInsights().catch(() => []),
    getMissingData().catch(() => []),
    getPreviewedImportCount().catch(() => 0),
    getStaleCloses().catch(() => []),
    getOverdueActions(today).catch(() => []),
    loadPersistedExceptions().catch(() => []),
  ]);

  const base: ExceptionInput = {
    today,
    staleDays: staleFrom(insights),
    lastDataDate: ctx?.snapshot?.meta.lastDataDate ?? null,
    insights, missing, importsAwaitingApproval, staleCloses, actionsOverdue,
  };
  // richer signals when the caller already built the report
  const input: ExceptionInput = ctx?.snapshot && ctx?.report
    ? { ...base, staleDays: ctx.snapshot.meta.staleDays, ...reportExceptionSignals(ctx.snapshot, ctx.report, today) }
    : base;

  const live = composeExceptions(input);
  const { visible, upserts, autoResolvedIds } = reconcileLifecycle(live, persisted, now);
  await syncExceptionLifecycle(upserts, metaFrom(live), now).catch(() => { /* lifecycle bookkeeping is best-effort */ });
  return { visible, autoResolvedIds };
}

/** staleDays isn't in the light signal set; the snapshot path overrides it.
 *  Without a snapshot we leave it null (books_stale then comes from the report
 *  path only) to avoid double-counting the stale-sales insight. */
function staleFrom(_insights: unknown[]): number | null {
  return null;
}
