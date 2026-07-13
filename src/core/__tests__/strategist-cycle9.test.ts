import { describe, it, expect } from "vitest";
import {
  detectCloseState, closeIsStale, applyCloseTransition,
  type DailyCloseFacts, type CloseRecordState,
} from "@/core/strategist/analysis/daily-close";
import {
  composeExceptions, reconcileLifecycle,
  type ExceptionInput, type OperationalException, type PersistedExceptionState,
} from "@/core/strategist/analysis/exceptions";
import { composeDailyBrief, type BriefInput } from "@/core/strategist/analysis/brief";
import { computeDenomCount } from "@/core/strategist/analysis/denomination";
import { classifyAttribution, summarizeExecution, type ActionHistoryItem } from "@/core/strategist/analysis/execution";
import { detectOperationalIntent, answerOperationalQuestion, type OperationalAnswerCtx } from "@/core/strategist/analysis/operational-answers";
import { projectNotifications } from "@/core/strategist/analysis/notifications";
import { isIdempotentDuplicate } from "@/core/db/idempotency";

/* ═══ DAILY CLOSE AUTOMATION (Phase 2/3) ═══════════════════════════════ */

const facts = (over: Partial<DailyCloseFacts> = {}): DailyCloseFacts => ({
  date: "2026-06-10",
  salesRecorded: true,
  salesVerification: "verified",
  productLinesPresent: true,
  productLinesReconcile: true,
  markedNoTrading: false,
  expensesRecorded: true,
  purchasesRecorded: true,
  importsAwaitingApproval: 0,
  unmappedLines: 0,
  missingCogsLines: 0,
  cashCountRequired: false,
  cashCountRecorded: false,
  cashDifferenceUnresolved: false,
  chequeNeedsUpdate: false,
  inventoryAlertsToAck: 0,
  criticalActionsOpen: 0,
  ...over,
});

describe("daily close — automatic detection", () => {
  it("auto-detects a fully complete day (ready, high confidence)", () => {
    const r = detectCloseState(facts());
    expect(r.canComplete).toBe(true);
    expect(r.recommendedStatus).toBe("ready");
    expect(r.confidence).toBe("high");
    expect(r.autoComplete.length).toBeGreaterThan(0);
    expect(r.blockReason).toBeNull();
  });

  it("blocks completion when sales are missing (never fabricated)", () => {
    const r = detectCloseState(facts({ salesRecorded: false, salesVerification: "none" }));
    expect(r.canComplete).toBe(false);
    expect(r.recommendedStatus).toBe("partial");
    expect(r.blocked.some((b) => b.key === "sales")).toBe(true);
    expect(r.blockReason).toMatch(/fabricated/i);
  });

  it("requires owner confirmation for what it cannot derive (no expenses)", () => {
    const r = detectCloseState(facts({ expensesRecorded: false }));
    expect(r.canComplete).toBe(false);
    expect(r.confirmRequired.some((c) => c.key === "expenses")).toBe(true);
    // owner confirms none → completes
    const r2 = detectCloseState(facts({ expensesRecorded: false }), { expensesNone: true });
    expect(r2.canComplete).toBe(true);
  });

  it("blocks completion on product-line mismatch (unresolved)", () => {
    const r = detectCloseState(facts({ productLinesReconcile: false }));
    expect(r.canComplete).toBe(false);
    expect(r.unresolved.some((u) => u.key === "product_lines")).toBe(true);
  });

  it("blocks completion while an import awaits approval", () => {
    const r = detectCloseState(facts({ importsAwaitingApproval: 2 }));
    expect(r.canComplete).toBe(false);
    expect(r.blocked.some((b) => b.key === "imports")).toBe(true);
  });

  it("recommends 'estimated' when sales are estimated", () => {
    const r = detectCloseState(facts({ salesVerification: "estimated" }));
    expect(r.canComplete).toBe(true);
    expect(r.recommendedStatus).toBe("estimated");
  });

  it("short-circuits a no-trading day to complete", () => {
    const r = detectCloseState(facts({ markedNoTrading: true, salesRecorded: false }));
    expect(r.recommendedStatus).toBe("no_trading");
    expect(r.canComplete).toBe(true);
    expect(r.completeness).toBe(100);
  });

  it("requires a cash count when policy demands it, unless explicitly skipped", () => {
    const r = detectCloseState(facts({ cashCountRequired: true, cashCountRecorded: false }));
    expect(r.canComplete).toBe(false);
    const skipped = detectCloseState(facts({ cashCountRequired: true, cashCountRecorded: false }), { cashSkip: { reason: "counted yesterday, drawer untouched" } });
    expect(skipped.canComplete).toBe(true);
  });

  it("keeps missing COGS optional — profit withheld, day still closes", () => {
    const r = detectCloseState(facts({ missingCogsLines: 3 }));
    expect(r.canComplete).toBe(true);
    expect(r.optional.some((o) => o.key === "cogs")).toBe(true);
  });
});

describe("daily close — lifecycle", () => {
  const rec = (over: Partial<CloseRecordState> = {}): CloseRecordState => ({ status: "complete", version: 1, sourceDataAt: "2026-06-10T18:00:00Z", voided: false, ...over });

  it("marks a completed close stale when a record changes after it", () => {
    const s = closeIsStale(rec(), "2026-06-11T09:00:00Z");
    expect(s.stale).toBe(true);
    expect(s.reason).toMatch(/changed after the close/i);
  });
  it("does not mark stale when nothing changed", () => {
    expect(closeIsStale(rec(), "2026-06-10T18:00:00Z").stale).toBe(false);
  });
  it("only completes when canComplete", () => {
    const bad = applyCloseTransition(null, "complete", { canComplete: false });
    expect(bad.ok).toBe(false);
    const good = applyCloseTransition(null, "complete", { canComplete: true, recommendedStatus: "ready", sourceDataAt: "t" });
    expect(good.ok).toBe(true);
    if (good.ok) { expect(good.next.status).toBe("complete"); expect(good.next.version).toBe(1); }
  });
  it("reopen requires a reason and bumps the version", () => {
    const noReason = applyCloseTransition(rec(), "reopen", {});
    expect(noReason.ok).toBe(false);
    const ok = applyCloseTransition(rec({ version: 2 }), "reopen", { reason: "correcting expense" });
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.next.status).toBe("reopened"); expect(ok.next.version).toBe(3); }
  });
  it("void preserves history and requires a reason", () => {
    const ok = applyCloseTransition(rec(), "void", { reason: "duplicate close" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.next.voided).toBe(true);
  });
});

/* ═══ CANONICAL EXCEPTION ENGINE (Phase 8/9) ═══════════════════════════ */

const input = (over: Partial<ExceptionInput> = {}): ExceptionInput => ({
  today: "2026-06-12", staleDays: null, lastDataDate: "2026-06-11", ...over,
});

describe("exception composition", () => {
  it("produces stable ids and neutral cash language", () => {
    const ex = composeExceptions(input({ cash: { differenceUnresolved: true, amount: -350, countAgeDays: 1, freshnessDays: 7 } }));
    const diff = ex.find((e) => e.type === "cash_difference");
    expect(diff?.id).toBe("cash_difference:open");
    expect(diff?.detail).not.toMatch(/theft|loss|stolen/i);
    expect(diff?.amountEgp).toBe(-350);
  });

  it("maps missing-data and imports; sorts by severity", () => {
    const ex = composeExceptions(input({
      missing: [{ key: "unmapped", title: "Unmapped lines", detail: "d", severity: "medium", count: 4, route: "/sales", action: "map" }],
      importsAwaitingApproval: 2,
    }));
    expect(ex.some((e) => e.type === "product_mapping_missing")).toBe(true);
    expect(ex.some((e) => e.type === "import_awaiting_approval")).toBe(true);
  });

  it("turns overdue obligations and actions into exceptions", () => {
    const ex = composeExceptions(input({
      obligationsOverdue: [{ title: "Salary", amount: 5700, dueDate: "2026-06-01" }],
      actionsOverdue: [{ id: "a1", title: "Raise price", screenLink: "/health", amount: null }],
    }));
    expect(ex.find((e) => e.type === "obligation_overdue")?.amountEgp).toBe(5700);
    expect(ex.find((e) => e.type === "action_overdue")?.id).toBe("action_overdue:a1");
  });

  it("flags stale books over the threshold", () => {
    const ex = composeExceptions(input({ staleDays: 9, lastDataDate: "2026-06-03" }));
    expect(ex.find((e) => e.type === "books_stale")?.severity).toBe("high");
  });

  it("dedups repeated ids (first producer wins)", () => {
    const ex = composeExceptions(input({
      insights: [{ key: "cash-x", severity: "critical", title: "Cash", detail: "d", action: "a", route: "/money", confidence: "high" }],
    }));
    expect(ex.filter((e) => e.id === "insight:cash-x")).toHaveLength(1);
  });
});

describe("exception lifecycle reconciliation", () => {
  const liveEx: OperationalException = {
    id: "cash_difference:open", type: "cash_difference", severity: "high", urgency: "this_week",
    source: "cash", title: "Diff", detail: "d", affectedDate: null, affectedEntity: null,
    amountEgp: -400, confidence: "medium", resolutionAction: "a", screenLink: "/money", resolutionCriteria: "c",
  };
  const persisted = (over: Partial<PersistedExceptionState> = {}): PersistedExceptionState => ({
    id: "cash_difference:open", status: "open", firstSeenAt: "2026-06-01T00:00:00Z", lastSeenAt: "2026-06-10T00:00:00Z",
    recurrenceCount: 1, lastSeverityRank: 3, dismissReason: null, suppressedUntil: null, ownerNote: null, resolvedAt: null, ...over,
  });
  const NOW = "2026-06-12T08:00:00Z";

  it("a brand-new issue becomes open + visible", () => {
    const r = reconcileLifecycle([liveEx], [], NOW);
    expect(r.visible).toHaveLength(1);
    expect(r.visible[0].status).toBe("open");
    expect(r.visible[0].isNew).toBe(true);
  });

  it("a resolved issue that returns is reopened and its recurrence increments", () => {
    const r = reconcileLifecycle([liveEx], [persisted({ status: "resolved", recurrenceCount: 1, resolvedAt: "2026-06-05T00:00:00Z" })], NOW);
    expect(r.visible[0].status).toBe("reopened");
    expect(r.visible[0].recurrenceCount).toBe(2);
  });

  it("a dismissed low-risk issue stays suppressed (not visible)", () => {
    const low = { ...liveEx, severity: "low" as const };
    const r = reconcileLifecycle([low], [persisted({ status: "dismissed", lastSeverityRank: 1, dismissReason: "known", suppressedUntil: "2026-12-01" })], NOW);
    expect(r.visible).toHaveLength(0);
  });

  it("a dismissed issue that materially worsens reopens", () => {
    const r = reconcileLifecycle([liveEx], [persisted({ status: "dismissed", lastSeverityRank: 1, dismissReason: "known", suppressedUntil: "2026-12-01" })], NOW);
    expect(r.visible[0].status).toBe("reopened");
  });

  it("a critical issue never silently stays dismissed", () => {
    const crit = { ...liveEx, severity: "critical" as const };
    const r = reconcileLifecycle([crit], [persisted({ status: "dismissed", lastSeverityRank: 4, dismissReason: "x", suppressedUntil: "2026-12-01" })], NOW);
    expect(r.visible[0].status).toBe("reopened");
  });

  it("auto-resolves a persisted-open issue that is no longer live", () => {
    const r = reconcileLifecycle([], [persisted({ status: "open" })], NOW);
    expect(r.visible).toHaveLength(0);
    expect(r.autoResolvedIds).toContain("cash_difference:open");
  });
});

/* ═══ DAILY OWNER BRIEF (Phase 10) ═════════════════════════════════════ */

const briefInput = (over: Partial<BriefInput> = {}): BriefInput => ({
  today: "2026-06-12", lastDataDate: "2026-06-11", staleDays: 1, isStale: false,
  lastDay: { date: "2026-06-11", revenue: 4200, expenses: 300, grossProfit: 1800, grossProfitCovered: true, topProduct: "بونبون" },
  lastDayClose: "complete",
  cashReconciled: true, cashConfidence: "high", inventoryConfidence: "medium", financialConfidence: "high",
  nextChequeEta: "2026-06-20", overdueCheques: [], obligationsNext7: 5700,
  requiredRecordsToday: [], exceptions: { critical: 0, high: 0, total: 0, top: null },
  primaryAction: null, secondaryActions: [], missing: [], readiness: "live_verified",
  ...over,
});

describe("daily owner brief", () => {
  it("is healthy with no exceptions and current books", () => {
    const b = composeDailyBrief(briefInput());
    expect(b.health).toBe("healthy");
    expect(b.yesterday.complete).toBe(true);
    expect(b.today.lines.some((l) => /obligations/i.test(l))).toBe(true);
  });

  it("reports critical health when a critical exception is open", () => {
    const b = composeDailyBrief(briefInput({ exceptions: { critical: 1, high: 0, total: 1, top: { title: "x", screenLink: "/money" } } }));
    expect(b.health).toBe("critical");
  });

  it("reports 'activating' during setup regardless of exceptions", () => {
    const b = composeDailyBrief(briefInput({ readiness: "historical_only" }));
    expect(b.health).toBe("activating");
  });

  it("flags stale books", () => {
    const b = composeDailyBrief(briefInput({ isStale: true, staleDays: 12 }));
    expect(b.health).toBe("stale");
    expect(b.trust.staleData).toMatch(/12 days/);
  });

  it("withholds gross profit when coverage is incomplete", () => {
    const b = composeDailyBrief(briefInput({ lastDay: { date: "2026-06-11", revenue: 4200, expenses: 300, grossProfit: null, grossProfitCovered: false, topProduct: null } }));
    expect(b.yesterday.lines.some((l) => /withheld/i.test(l))).toBe(true);
  });
});

/* ═══ DENOMINATION COUNTING (Phase 4) ══════════════════════════════════ */

describe("denomination counting", () => {
  it("totals denomination lines and floors quantities", () => {
    const r = computeDenomCount({ lines: [{ denom: 200, qty: 3 }, { denom: 50, qty: 2 }, { denom: 1, qty: 4.9 }] });
    expect(r.denomTotal).toBe(704);        // 600 + 100 + 4
    expect(r.drawerTotal).toBe(704);
    expect(r.mismatch).toBe(false);
  });
  it("surfaces a mismatch and requires confirmation", () => {
    const r = computeDenomCount({ lines: [{ denom: 100, qty: 5 }], manualTotal: 480 });
    expect(r.mismatch).toBe(true);
    expect(r.mismatchAmount).toBe(-20);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.drawerTotal).toBe(480);       // manual wins, but flagged
  });
  it("accepts a manual-only total", () => {
    const r = computeDenomCount({ lines: [], manualTotal: 1000, pettyCash: 50, bankBalance: 2000 });
    expect(r.mismatch).toBe(false);
    expect(r.drawerTotal).toBe(1000);
    expect(r.pettyCash).toBe(50);
    expect(r.bankBalance).toBe(2000);
  });
});

/* ═══ EXECUTION TRACKING (Phase 12) ════════════════════════════════════ */

describe("outcome attribution", () => {
  it("is inconclusive when coverage is poor", () => {
    expect(classifyAttribution({ actionCompleted: true, improved: true, coverageOk: false, magnitudePct: 10, concurrentChanges: 0 }).attribution).toBe("inconclusive");
  });
  it("is strong when completed, moved clearly, few concurrent changes", () => {
    expect(classifyAttribution({ actionCompleted: true, improved: true, coverageOk: true, magnitudePct: 8, concurrentChanges: 1 }).attribution).toBe("strong");
  });
  it("is weak when improved without the action", () => {
    expect(classifyAttribution({ actionCompleted: false, improved: true, coverageOk: true, magnitudePct: 8, concurrentChanges: 0 }).attribution).toBe("weak");
  });
  it("flags often-ignored and completed-but-unresolved", () => {
    const items: ActionHistoryItem[] = [
      { status: "accepted", acceptedAt: "2026-06-01", completedAt: null, reviewOverdue: true, issueStillOpen: true },
      { status: "accepted", acceptedAt: "2026-06-02", completedAt: null, reviewOverdue: false, issueStillOpen: true },
      { status: "completed", acceptedAt: "2026-06-01", completedAt: "2026-06-02", reviewOverdue: false, issueStillOpen: true },
    ];
    const s = summarizeExecution(items);
    expect(s.oftenIgnored).toBe(true);
    expect(s.completedButUnresolved).toBe(1);
    expect(s.quickWins).toBe(1);
  });
});

/* ═══ DETERMINISTIC OPERATIONAL ANSWERS (Phase 20) ═════════════════════ */

const answerCtx = (over: Partial<OperationalAnswerCtx> = {}): OperationalAnswerCtx => ({
  brief: composeDailyBrief(briefInput()),
  exceptions: [],
  close: detectCloseState(facts({ salesRecorded: false, salesVerification: "none" })),
  activationReadiness: "live_operational",
  activationNext: null,
  cashDifferenceCandidates: [],
  stockVariances: [],
  overdueActions: [],
  staleCloses: [],
  ...over,
});

describe("deterministic operational answers", () => {
  it("routes free text to intents", () => {
    expect(detectOperationalIntent("why can't I close the day?")).toBe("why_cant_close");
    expect(detectOperationalIntent("what caused this cash difference")).toBe("cash_difference_cause");
    expect(detectOperationalIntent("is BostaOS ready to go live?")).toBe("ready_for_activation");
    expect(detectOperationalIntent("what's the weather")).toBeNull();
  });
  it("explains why a day can't close from the evaluation", () => {
    const a = answerOperationalQuestion("why_cant_close", answerCtx());
    expect(a.grounded).toBe(true);
    expect(a.points.join(" ")).toMatch(/sales/i);
  });
  it("lists cash-difference candidates neutrally", () => {
    const a = answerOperationalQuestion("cash_difference_cause", answerCtx({ cashDifferenceCandidates: [{ label: "Missing cash expense", suggestedAction: "check expenses" }] }));
    expect(a.points.length).toBe(1);
    expect(a.headline).not.toMatch(/theft|stolen/i);
  });
});

/* ═══ NOTIFICATIONS (Phase 19) ═════════════════════════════════════════ */

describe("notification projection", () => {
  it("projects exceptions to notification events and respects prefs", () => {
    const ex = composeExceptions(input({ cash: { differenceUnresolved: true, amount: -300, countAgeDays: 1, freshnessDays: 7 } }));
    const notes = projectNotifications(ex);
    expect(notes.some((n) => n.type === "cash_difference")).toBe(true);
    const off = projectNotifications(ex, { cash_difference: { enabled: false } });
    expect(off.some((n) => n.type === "cash_difference")).toBe(false);
  });
});

/* ═══ IDEMPOTENCY (Phase 13) ═══════════════════════════════════════════ */

describe("idempotency duplicate detection", () => {
  it("treats a 23505 on an *_idem index as a duplicate", () => {
    expect(isIdempotentDuplicate({ code: "23505", message: 'duplicate key value violates unique constraint "uq_expenses_idem"' })).toBe(true);
    expect(isIdempotentDuplicate({ code: "23505", constraint: "uq_movements_idem" })).toBe(true);
  });
  it("does not swallow other unique violations", () => {
    expect(isIdempotentDuplicate({ code: "23505", message: 'duplicate key value violates unique constraint "uq_active_sale_day"' })).toBe(false);
    expect(isIdempotentDuplicate({ code: "23502", message: "not null" })).toBe(false);
    expect(isIdempotentDuplicate(null)).toBe(false);
  });
});
