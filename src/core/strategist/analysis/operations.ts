/** Operational workflows — PURE (Cycle 8): daily close, sales catch-up gap
 *  detection, action-oriented missing-data grouping, and the live health
 *  score that separates historical completeness from live completeness. */
import type { StrategistSnapshot } from "../contract";
import type { ActivationChecklist } from "./activation";

const r1 = (n: number) => Math.round(n * 10) / 10;

/* ── daily close ──────────────────────────────────────────────────────── */

export interface DailyCloseInputs {
  date: string;
  salesRecorded: boolean;
  productLinesRecordedOrMarked: boolean;   // recorded OR explicitly "unavailable"
  expensesConsidered: boolean;              // owner confirmed expenses entered / none
  purchasesConsidered: boolean;
  chequeUpdatedIfRelevant: boolean;
  cashCountRecordedIfRequired: boolean;     // policy-driven; true when not required
  noUnresolvedCashDifference: boolean;
  noImportsAwaitingApproval: boolean;
  noMissingProductMappings: boolean;
  requestedStatus: "complete" | "partial" | "estimated" | "no_trading";
}

export interface DailyCloseResult {
  date: string;
  status: "complete" | "partial" | "estimated" | "no_trading";
  completeness: number;                     // 0–100
  checklist: { key: string; ok: boolean; required: boolean }[];
  unresolved: string[];
  nextAction: string | null;
  blockedFromComplete: boolean;
  blockReason: string | null;
}

const CLOSE_ITEMS: { key: string; label: string; required: boolean; pick: (i: DailyCloseInputs) => boolean }[] = [
  { key: "sales", label: "Today's sales recorded", required: true, pick: (i) => i.salesRecorded },
  { key: "product_lines", label: "Product-line sales recorded or marked unavailable", required: false, pick: (i) => i.productLinesRecordedOrMarked },
  { key: "expenses", label: "Expenses entered (or none)", required: true, pick: (i) => i.expensesConsidered },
  { key: "purchases", label: "Purchases entered (or none)", required: false, pick: (i) => i.purchasesConsidered },
  { key: "cheque", label: "Cheque update recorded if relevant", required: false, pick: (i) => i.chequeUpdatedIfRelevant },
  { key: "cash_count", label: "Cash counted if required by policy", required: true, pick: (i) => i.cashCountRecordedIfRequired },
  { key: "cash_diff", label: "No unresolved cash difference", required: false, pick: (i) => i.noUnresolvedCashDifference },
  { key: "imports", label: "No imports awaiting approval", required: false, pick: (i) => i.noImportsAwaitingApproval },
  { key: "mappings", label: "No missing product mappings", required: false, pick: (i) => i.noMissingProductMappings },
];

export function composeDailyClose(i: DailyCloseInputs): DailyCloseResult {
  if (i.requestedStatus === "no_trading") {
    return { date: i.date, status: "no_trading", completeness: 100, checklist: [], unresolved: [], nextAction: null, blockedFromComplete: false, blockReason: null };
  }
  const checklist = CLOSE_ITEMS.map((it) => ({ key: it.key, ok: it.pick(i), required: it.required }));
  const requiredMissing = checklist.filter((c) => c.required && !c.ok);
  const okCount = checklist.filter((c) => c.ok).length;
  const completeness = r1((okCount / checklist.length) * 100);
  const unresolved = CLOSE_ITEMS.filter((it) => !it.pick(i)).map((it) => it.label);

  const blocked = i.requestedStatus === "complete" && requiredMissing.length > 0;
  const status: DailyCloseResult["status"] = blocked
    ? "partial"
    : i.requestedStatus;
  return {
    date: i.date, status, completeness, checklist, unresolved,
    nextAction: requiredMissing[0] ? CLOSE_ITEMS.find((c) => c.key === requiredMissing[0].key)!.label : null,
    blockedFromComplete: blocked,
    blockReason: blocked ? `Cannot mark complete — required item(s) missing: ${requiredMissing.map((r) => r.key).join(", ")}. Nothing is fabricated to close the day.` : null,
  };
}

/* ── sales catch-up gap detection ─────────────────────────────────────── */

export interface SalesGap { date: string; kind: "missing" | "total_only" | "awaiting_import"; priority: number }

/** Pure gap detection from the set of recorded dates. Most-recent gaps first.
 *  Never assumes zero sales — a missing day is "missing", to be entered or
 *  confirmed as a closed/no-trading day by the owner. */
export function detectSalesGaps(
  recordedDates: Set<string>, datesWithLinesMissing: Set<string>, awaitingImport: Set<string>,
  fromDate: string, today: string,
): SalesGap[] {
  const gaps: SalesGap[] = [];
  const start = Date.parse(fromDate);
  const end = Date.parse(today);
  for (let t = end; t >= start; t -= 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const ageDays = Math.round((end - t) / 86_400_000);
    const priority = 1000 - ageDays;              // recent = higher
    if (awaitingImport.has(d)) gaps.push({ date: d, kind: "awaiting_import", priority: priority + 500 });
    else if (!recordedDates.has(d)) gaps.push({ date: d, kind: "missing", priority: priority + 200 });
    else if (datesWithLinesMissing.has(d)) gaps.push({ date: d, kind: "total_only", priority });
  }
  return gaps.sort((a, b) => b.priority - a.priority);
}

/* ── action-oriented missing-data centre ──────────────────────────────── */

export interface MissingGroup { group: string; rank: number; items: { title: string; action: string; screenLink: string; required: boolean }[] }

export function groupMissingData(s: StrategistSnapshot, checklist: ActivationChecklist): MissingGroup[] {
  const groups: MissingGroup[] = [];

  // 1. Activate BostaOS (always outranks historical cleanup)
  const activate = checklist.steps
    .filter((x) => x.required && x.status !== "done" && ["live_start", "first_cash", "first_stock"].includes(x.key))
    .map((x) => ({ title: x.title, action: x.action, screenLink: x.screenLink, required: true }));
  if (activate.length) groups.push({ group: "Activate BostaOS", rank: 0, items: activate });

  // 2. Today
  const today: MissingGroup["items"] = [];
  if (s.meta.isStale) today.push({ title: `Sales missing since ${s.meta.lastDataDate}`, action: "Enter or import recent sales", screenLink: "/sales/import", required: true });
  if (checklist.steps.find((x) => x.key === "first_close")?.status !== "done") today.push({ title: "Daily close not current", action: "Run the daily close", screenLink: "/health", required: false });
  if (today.length) groups.push({ group: "Today", rank: 1, items: today });

  // 3. Financial confidence
  const fin: MissingGroup["items"] = [];
  if ((s.dataQuality.missingCostLines.value ?? 0) > 0) fin.push({ title: `${s.dataQuality.missingCostLines.value} sold lines lack cost`, action: "Add product costs", screenLink: "/costs", required: false });
  if (!s.cash.hasLiveData && s.cash.latestCount.value != null) fin.push({ title: "Cash count stale", action: "Re-count the drawer", screenLink: "/money", required: false });
  if (fin.length) groups.push({ group: "Financial confidence", rank: 2, items: fin });

  // 4. Inventory confidence
  const inv: MissingGroup["items"] = [];
  const missingCosts = s.products.missingCosts.value ?? [];
  if (missingCosts.length && s.inventory.hasLiveData) inv.push({ title: `${missingCosts.length} product(s) value-unknown (no cost)`, action: "Record costs", screenLink: "/costs", required: false });
  if (inv.length) groups.push({ group: "Inventory confidence", rank: 3, items: inv });

  // 5. Historical cleanup (ALWAYS last — never outranks live issues)
  const hist: MissingGroup["items"] = [];
  if ((s.dataQuality.uncoveredRevenueAllTime.value ?? 0) >= 1) hist.push({ title: "Older days lack product detail", action: "Import historical day reports (optional)", screenLink: "/sales/product-lines", required: false });
  if (hist.length) groups.push({ group: "Historical cleanup", rank: 9, items: hist });

  return groups.sort((a, b) => a.rank - b.rank);
}

/* ── live health score ────────────────────────────────────────────────── */

export interface LiveHealth {
  historicalCompleteness: number;   // the old blended score
  liveCompleteness: number;         // records after the live start date
  operationalReadiness: ActivationChecklist["readiness"];
  cashConfidence: "high" | "medium" | "low" | "none";
  inventoryConfidence: "high" | "medium" | "low" | "none";
  financialConfidence: "high" | "medium" | "low";
  wouldImprove: string[];
}

export function liveHealthScore(s: StrategistSnapshot, checklist: ActivationChecklist): LiveHealth {
  const cashCounted = s.cash.latestCount.value != null;
  const cashFresh = cashCounted && (s.cash.countAgeDays.value ?? 999) <= (s.context.cashCountFreshnessDays.value ?? 7);
  const stockTracked = s.inventory.hasLiveData;
  const coverage = s.products.coveragePct.value ?? 0;

  // live completeness: focus ONLY on the required activation baselines + current sales
  const liveChecks = [checklist.liveStartConfirmed, cashCounted, stockTracked, !s.meta.isStale];
  const liveCompleteness = Math.round((liveChecks.filter(Boolean).length / liveChecks.length) * 100);

  const wouldImprove: string[] = [];
  if (!checklist.liveStartConfirmed) wouldImprove.push("confirm the live-operations start date");
  if (!cashCounted) wouldImprove.push("record the first drawer count");
  if (!stockTracked) wouldImprove.push("record the first stock count");
  if (s.meta.isStale) wouldImprove.push("bring sales current");

  return {
    historicalCompleteness: s.meta.completenessScore,
    liveCompleteness,
    operationalReadiness: checklist.readiness,
    cashConfidence: cashFresh ? "high" : cashCounted ? "medium" : "none",
    inventoryConfidence: stockTracked ? "medium" : "none",
    financialConfidence: coverage >= 90 ? "high" : coverage >= 60 ? "medium" : "low",
    wouldImprove,
  };
}
