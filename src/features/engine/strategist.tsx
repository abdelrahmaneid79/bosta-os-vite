/** STRATEGIST WORKSPACE (Cycle 4) — the executive decision interface.
 *
 *  The deterministic engine is the operating layer: snapshot → findings →
 *  briefing/cards/queue all work with ZERO model calls. The LLM adds
 *  interpretation on explicit owner intent only (no auto-fire, no retries).
 *
 *  Components render trusted structured models from src/core/strategist/* —
 *  no financial math happens in this file. */
import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DeckTile, PageHdr, SubpageCard } from "./deck";
import { Button, Field, Input } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { Sheet } from "@/components/ui/motion";
import { cn } from "@/core/utils/cn";
import { SkeletonRows, ErrorState, EmptyState } from "@/components/feedback";
import { isEngineConfigured } from "@/core/db/engine";
import { egp } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { useUI } from "@/store/ui";
import { todayCairo, isoDaysAgo } from "@/core/time";
import { assembleSalesGaps } from "@/core/read/sales-gaps";
import { getRiskInsights } from "@/core/read/insights";
import { getMissingData } from "@/core/read/missing";
import type { SalesGap } from "@/core/strategist/analysis/operations";
import { assembleSnapshotV2 } from "@/core/strategist/snapshot-v2";
import type { Finding } from "@/core/strategist/analysis/types";
import type { StrategistSnapshot } from "@/core/strategist/contract";
import { buildStrategyReport, type StrategyReport } from "@/core/strategist/analysis/report";
import { selectWeeklyPriority } from "@/core/strategist/analysis/priority";
import { MIN_ATTRIBUTION_COVERAGE } from "@/core/strategist/analysis/products";
import type { ActivationChecklist } from "@/core/strategist/analysis/activation";
import { detectCloseState, type CloseEvaluation } from "@/core/strategist/analysis/daily-close";
import { BreakEvenPanel } from "./BreakEvenPanel";
import { assembleCloseFacts, closeSourceDataAt, type CloseSignals } from "@/core/read/daily-close";
import { confirmLiveStart, saveClose, reopenDailyClose, confirmNoTradingDay, getRecentCloses, loadAcceptedCommitments } from "@/core/strategist/persistence/operations";
import { refreshOperationalExceptions } from "@/core/strategist/exceptions-service";
import { acknowledgeException, dismissException } from "@/core/strategist/persistence/exceptions";
import { assembleDailyBrief } from "@/core/strategist/brief-service";
import type { ReconciledException } from "@/core/strategist/analysis/exceptions";
import type { DailyBrief } from "@/core/strategist/analysis/brief";
import { detectOperationalIntent, answerOperationalQuestion, type OperationalAnswerCtx } from "@/core/strategist/analysis/operational-answers";
import { getStaleCloses } from "@/core/read/daily-close";
import { assembleRetailRecommendations, type RetailResult } from "@/core/strategist/retail-service";
import type { RetailRecommendation } from "@/core/strategist/retail/contract";
import { createExperiment } from "@/core/strategist/persistence/experiments";
import { nextQuestions, interviewProgress, type PendingQuestion } from "@/core/strategist/retail/interview";
import { assembleInterviewState, markQuestionAnswered, saveRetailContext, listProductsForContext, setProductContext, listPackagingFormats, createPackagingFormat, type ProductContextRow } from "@/core/strategist/persistence/retail-context";
import { assessWithdrawalV2, assessAffordability } from "@/core/strategist/analysis/affordability";
import { computeCalendar } from "@/core/strategist/calendar";
import { suggestQuestions } from "@/core/strategist/questions";
import { generateLanguage, loadLanguageSettings, saveLanguageSettings, providerHealth } from "@/core/strategist/language/router";
import { type LanguageMode, type LanguageResult, type LanguageSettings, type ProviderHealth, DEFAULT_LANGUAGE_SETTINGS } from "@/core/strategist/language/types";
import { timings, timed, timedSync } from "@/core/strategist/diagnostics";
import type { StrategistResponse, ResponsePriority } from "@/core/strategist/response";
import { loadOwnerContext, saveOwnerContext, CONTEXT_DEFAULTS, type OwnerContextAnswers } from "@/core/strategist/context";
import {
  syncInsights, listInsights, setInsightStatus, type InsightRow,
  createAction, listActions, updateActionStatus, type ActionRow,
  createConversation, addMessage, getMessages, listConversations,
  recordFeedback, getCachedBriefing, saveCachedBriefing, listRecentFeedback, syncOutcomes,
} from "@/core/strategist/persistence/store";
import { buildOwnerMemory } from "@/core/strategist/persistence/lifecycle";

const en = isEngineConfigured;

/* ── owner-language translation of technical metadata ─────────────────── */
const SOURCE_LABEL: [RegExp, string][] = [
  [/read\/profit/, "Audited profit read-model"],
  [/read\/sales/, "Daily sales book"],
  [/read\/products/, "Product sales detail"],
  [/read\/money/, "Cash ledger"],
  [/read\/expenses/, "Expense book"],
  [/read\/stock/, "Stock positions"],
  [/cheque-cycle|settlements/, "Settlement & cheque records"],
  [/cash_reconciliations/, "Drawer counts"],
  [/strategist_context|documented default|owner answer/, "Your settings (Tune)"],
];
const ownerSource = (s: string) => SOURCE_LABEL.find(([re]) => re.test(s))?.[1] ?? s;

const CLASS_META: Record<Finding["class"], { label: string; color: string }> = {
  contradiction: { label: "Contradiction", color: "var(--red)" },
  decision_risk: { label: "Decision risk", color: "var(--red)" },
  warning: { label: "Risk", color: "var(--amber)" },
  opportunity: { label: "Opportunity", color: "var(--green)" },
  data_quality: { label: "Data quality", color: "rgb(var(--violet))" },
  fact: { label: "Fact", color: "rgb(var(--dim))" },
  forecast: { label: "Forecast", color: "rgb(var(--cyan))" },
  recommendation: { label: "Recommendation", color: "var(--mag)" },
};
const URGENCY_LABEL: Record<string, string> = { today: "Today", this_week: "This week", this_month: "This month", monitor: "Monitor" };
const CONF_LABEL: Record<string, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

function Chip({ text, color }: { text: string; color: string }) {
  return <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color, border: `1px solid ${color}`, borderRadius: 999, padding: "2px 8px", opacity: 0.9 }}>{text}</span>;
}

/* ═══ MAIN SCREEN ═════════════════════════════════════════════════════ */

/** Entry point to a subpage. Heavy detail opens in its own focused view rather
 *  than stacking on this page — one thing to look at, not everything at once. */

export function StrategistScreen() {
  const qc = useQueryClient();
  const { reportError, reportSuccess } = useUI();

  const snapQ = useQuery({ queryKey: ["snapshot-v2"], queryFn: () => timed("snapshotMs", assembleSnapshotV2), enabled: en, staleTime: 5 * 60_000 });
  const commitmentsQ = useQuery({ queryKey: ["strategist-commitments"], queryFn: loadAcceptedCommitments, enabled: en });
  const s = snapQ.data;
  const report = useMemo(() => (s ? timedSync("engineMs", () => buildStrategyReport(s, commitmentsQ.data ?? [])) : null), [s, commitmentsQ.data]);
  const findings = report?.findings ?? [];

  // persist qualifying findings once per snapshot (evidence-based lifecycle)
  const syncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!s || findings.length === 0) return;
    const key = `${s.meta.period.label}|${s.meta.lastDataDate}`;
    if (syncedFor.current === key) return;
    syncedFor.current = key;
    const coverageOk = (s.products.coveragePct.value ?? 0) >= MIN_ATTRIBUTION_COVERAGE;
    timed("syncMs", async () => {
      await syncInsights(findings, s.meta.period.label);
      await syncOutcomes(findings, todayCairo(), coverageOk);
    })
      .then(() => { qc.invalidateQueries({ queryKey: ["strategist-insights"] }); qc.invalidateQueries({ queryKey: ["strategist-actions"] }); })
      .catch(() => { syncedFor.current = null; });
  }, [s, findings, qc]);

  const insightsQ = useQuery({ queryKey: ["strategist-insights"], queryFn: listInsights, enabled: en });
  const actionsQ = useQuery({ queryKey: ["strategist-actions"], queryFn: listActions, enabled: en });

  // Cycle 9 — canonical operational exceptions + deterministic daily brief.
  // refreshOperationalExceptions composes → reconciles lifecycle → persists.
  const opsQ = useQuery({
    queryKey: ["strategist-ops", s?.meta.generatedAt ?? null],
    enabled: en && !!s && !!report,
    queryFn: () => timed("exceptionMs", async () => {
      const { visible } = await refreshOperationalExceptions({ snapshot: s!, report: report! });
      const brief = await assembleDailyBrief(s!, report!, visible);
      return { exceptions: visible, brief };
    }),
  });

  // Cycle 10 — Retail Reasoning: specific, grounded commercial recommendations, zero API.
  const retailQ = useQuery({
    queryKey: ["strategist-retail", s?.meta.generatedAt ?? null],
    enabled: en && !!s && !!report,
    queryFn: () => assembleRetailRecommendations(s!, report!),
  });

  // Cycle 13 — sales catch-up workspace over the (previously unsurfaced) detectSalesGaps engine.
  const gapsQ = useQuery({
    queryKey: ["sales-gaps", s?.meta.today],
    enabled: en && !!s,
    queryFn: () => assembleSalesGaps(isoDaysAgo(s!.meta.today, 29), s!.meta.today),
  });

  // Cycle 11 — Owner Knowledge Interview: ask only what can't be derived.
  const interviewQ = useQuery({
    queryKey: ["strategist-interview"],
    enabled: en,
    queryFn: async () => {
      const state = await assembleInterviewState();
      return { questions: nextQuestions(state, 3), progress: interviewProgress(state) };
    },
  });

  const [drawer, setDrawer] = useState<Finding | null>(null);
  const [tuneOpen, setTuneOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  // Section disclosure: null = follow the data signal (open when something needs the owner)
  const [opsOpen, setOpsOpen] = useState<boolean | null>(null);
  const [intelOpen, setIntelOpen] = useState<boolean | null>(null);

  if (!en) return <EmptyState title="Sign in to load the strategist" />;
  if (snapQ.isError) {
    const msg = String((snapQ.error as Error)?.message ?? "");
    return <ErrorState message={`Couldn't load the snapshot — ${msg}. Reload to retry.`} />;
  }
  if (snapQ.isLoading || !s || !report) return <div className="cdk"><SkeletonRows rows={8} /></div>;

  const insights = insightsQ.data ?? [];
  const insightByFinding = new Map(insights.map((i) => [i.findingId, i]));
  const actions = actionsQ.data ?? [];
  const weekly = selectWeeklyPriority(report, {
    dismissed: insights.filter((i) => i.status === "dismissed").map((i) => ({ findingId: i.findingId, impactEgp: i.impactEgp })),
    openActionFindingIds: actions.filter((a) => ["suggested", "accepted", "in_progress"].includes(a.status) && a.findingId).map((a) => a.findingId as string),
    reviewPeriodDays: 14,
  });

  // ── section signals: open what needs the owner, fold what doesn't ──────
  const exceptions = opsQ.data?.exceptions ?? [];
  const activating = report.activation.readiness === "historical_only" || report.activation.readiness === "activation_incomplete";
  const interviewPending = (interviewQ.data?.questions.length ?? 0) > 0;
  const openActions = actions.filter((a) => ["suggested", "accepted", "in_progress"].includes(a.status)).length;
  const gaps = gapsQ.data ?? [];
  const opsCritical = exceptions.some((e) => e.severity === "critical" || e.severity === "high");
  const opsBadgeCount = exceptions.length + (interviewPending ? 1 : 0) + openActions + gaps.length;

  return (
    <div className="cdk space-y-4">
      {/* ═══ COMMAND HEADER — one glance: what period, how fresh, one setting ═══ */}
      <PageHdr title="Strategist" sub="Your books, read like an operator"
        right={<button className="addbtn" onClick={() => setTuneOpen(true)}>⚙ Tune</button>} />
      <FreshnessStrip s={s} />

      {/* ═══ FIRST THING SEEN — where the business stands today ═══ */}
      <DailyBriefCard brief={opsQ.data?.brief ?? null} loading={opsQ.isLoading} />

      {/* ═══ EARN — am I actually making money this month, and what's left to do ═══ */}
      <BreakEvenPanel />
      <RetailAdvisor result={retailQ.data ?? null} loading={retailQ.isLoading}
        onExperiment={async (r) => {
          await createExperiment({
            playbookId: r.playbookId, title: r.title, domain: r.domain, recType: r.type,
            productIds: r.affectedProductIds, location: r.affectedLocation, changeDescription: r.proposedAction,
            startDate: todayCairo(), endDate: r.reviewDate, baseline: null,
            primaryMetric: r.successCriteria[0] ?? r.expectedBenefitType, secondaryMetrics: r.baselineMetrics,
            guardrailMetrics: r.failureCriteria, minSample: null, successThreshold: r.successCriteria.join("; "),
            failureThreshold: r.failureCriteria.join("; "), stopCondition: r.stopCondition, status: "proposed",
            result: null, conclusion: null, attributionConfidence: null, decision: null, ownerNotes: null,
          });
          reportSuccess("Experiment", "Added to your test plan");
          qc.invalidateQueries({ queryKey: ["strategist-retail"] });
        }} />
      <WeeklyPriorityCard weekly={weekly} onQueue={async (item) => {
        const f = findings.find((x) => x.id === item.findingId);
        const res = await createAction({
          title: f?.action?.title ?? item.action, description: item.action, source: "finding",
          findingId: item.findingId, category: f?.class ?? "general",
          priority: "high", screenLink: item.screenLink, expectedOutcome: item.expectedOutcome,
          status: "accepted", baselineFinding: f ?? null,
        });
        reportSuccess("Action queue", res.created ? "Queued this week's priority" : "Already queued");
        qc.invalidateQueries({ queryKey: ["strategist-actions"] });
      }} />

      {/* ═══ SUBPAGES — each opens as its own focused view, so this page stays calm ═══ */}
      <div className="sp-grid">
        <SubpageCard title="Run the day"
          sub={activating ? "Activation in progress" : "Exceptions, close, setup & queue"}
          badge={opsBadgeCount || undefined} urgent={opsCritical} onClick={() => setOpsOpen(true)} />
        <SubpageCard title="Intelligence" sub="Findings, products & cash"
          badge={findings.length || undefined} onClick={() => setIntelOpen(true)} />
      </div>

      <Sheet open={!!opsOpen} onClose={() => setOpsOpen(false)} title="Run the day" wide>
        <FixThesePanel />
        <OperationalExceptionsPanel exceptions={exceptions} loading={opsQ.isLoading}
          onAck={async (id) => { await acknowledgeException(id); qc.invalidateQueries({ queryKey: ["strategist-ops"] }); reportSuccess("Exceptions", "Acknowledged"); }}
          onDismiss={async (id, reason) => { await dismissException(id, reason); qc.invalidateQueries({ queryKey: ["strategist-ops"] }); reportSuccess("Exceptions", "Dismissed"); }} />
        <SalesCatchUpWorkspace gaps={gaps} loading={gapsQ.isLoading} />
        <DailyCloseTile lastDataDate={s.meta.lastDataDate}
          signals={{
            cashCountRequired: report.activation.liveStartConfirmed && s.cash.hasLiveData,
            cashDifferenceUnresolved: s.cash.hasLiveData && (s.cash.unexplainedDifference.value ?? 0) !== 0,
            chequeNeedsUpdate: (s.cheques.overduePeriods.value ?? []).length > 0,
            inventoryAlertsToAck: (s.products.stockRisk.value ?? []).length,
            criticalActionsOpen: report.findings.filter((f) => (f.class === "warning" || f.class === "contradiction") && f.urgency === "today").length,
          }}
          onError={(e) => reportError("Daily close", e)} onSaved={() => reportSuccess("Daily close", "Recorded")} />
        <ActivationTile checklist={report.activation} liveHealth={report.liveHealth}
          onConfirmStart={async (d) => { await confirmLiveStart(d); qc.invalidateQueries({ queryKey: ["snapshot-v2"] }); reportSuccess("Activation", "Live start date confirmed"); }} />
        <OwnerInterviewCard data={interviewQ.data ?? null} onOpenSetup={() => setSetupOpen(true)}
          onMarkUnknown={async (id) => { await markQuestionAnswered(id); qc.invalidateQueries({ queryKey: ["strategist-interview"] }); }}
          onAnswerList={async (id, field, values) => { await saveRetailContext({ [field]: values } as never); await markQuestionAnswered(id); qc.invalidateQueries({ queryKey: ["strategist-interview"] }); qc.invalidateQueries({ queryKey: ["strategist-retail"] }); reportSuccess("Owner knowledge", "Saved — advice will use it"); }} />
        <ActionQueue actions={actionsQ.data ?? []} onUpdate={async (id, status, note) => {
          await updateActionStatus(id, status, note); qc.invalidateQueries({ queryKey: ["strategist-actions"] });
        }} />
      </Sheet>

      {/* ═══ INTELLIGENCE — the full analysis, folded until wanted ═══ */}
      <Sheet open={!!intelOpen} onClose={() => setIntelOpen(false)} title="Intelligence" wide>
        <ExecutiveBriefing s={s} report={report} weekly={weekly} />
        <WhatMattersNow findings={findings} insightByFinding={insightByFinding} onEvidence={setDrawer}
          onStatus={async (row, status) => { await setInsightStatus(row.id, status); qc.invalidateQueries({ queryKey: ["strategist-insights"] }); }}
          onAccept={async (f) => {
            const a = f.action;
            const res = await createAction({
              title: a?.title ?? f.title, description: a?.action ?? f.detail, source: "finding",
              findingId: f.id, category: f.class, priority: f.urgency === "today" ? "high" : f.urgency === "this_week" ? "medium" : "low",
              screenLink: a?.screenLink ?? "/health", expectedOutcome: a?.expectedImpact ?? null, status: "accepted",
              baselineFinding: f,
            });
            reportSuccess("Action queue", res.created ? "Added to your action queue" : "Already in your queue");
            qc.invalidateQueries({ queryKey: ["strategist-actions"] });
          }} />
        <ProductStrategy report={report} />
        <CashIntelligence report={report} />
      </Sheet>

      {/* ═══ ASK — one surface for questions AND decisions ═══ */}
      <AskDecide s={s} report={report} actions={actionsQ.data ?? []} insights={insights}
        brief={opsQ.data?.brief ?? null} exceptions={exceptions} />

      <RetailSetupModal open={setupOpen} onClose={() => setSetupOpen(false)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["strategist-interview"] }); qc.invalidateQueries({ queryKey: ["strategist-retail"] }); }}
        onError={(e) => reportError("Stand setup", e)} />
      <EvidenceDrawer finding={drawer} onClose={() => setDrawer(null)} />
      <TuneModal open={tuneOpen} onClose={() => setTuneOpen(false)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["snapshot-v2"] }); reportSuccess("Strategist", "Settings saved — snapshot refreshed"); }}
        onError={(e) => reportError("Strategist settings", e)} />
    </div>
  );
}

/* ═══ FRESHNESS ═══════════════════════════════════════════════════════ */

function FreshnessStrip({ s }: { s: StrategistSnapshot }) {
  // Three chips only: how fresh, how far behind, how trustworthy. The full
  // data-health detail lives in the brief's Trust card, not up here.
  const score = s.meta.completenessScore;
  return (
    <div className="fs-row">
      <span className={cn("fs-chip", s.meta.isStale && "warn")}>
        <i />{s.meta.lastDataDate ? `Books to ${fmtDate(s.meta.lastDataDate)}` : "No sales yet"}
      </span>
      {s.meta.isStale && s.meta.staleDays != null && (
        <span className="fs-chip warn"><i />{s.meta.staleDays} days behind</span>
      )}
      <span className={cn("fs-chip", score < 60 && "warn")}><i />Trust {score}/100</span>
    </div>
  );
}

/* ═══ DAILY OWNER BRIEF (Cycle 9) ═════════════════════════════════════ */

const HEALTH_META: Record<DailyBrief["health"], { label: string; color: string }> = {
  healthy: { label: "Healthy", color: "var(--green)" },
  attention: { label: "Attention", color: "var(--amber)" },
  critical: { label: "Critical", color: "var(--red)" },
  activating: { label: "Activating", color: "rgb(var(--violet))" },
  stale: { label: "Books stale", color: "var(--amber)" },
};

/** The brief as a deck of cards — one idea per card, thumbed through like
 *  flashcards. Tap the card, swipe, use the arrows, or press ←/→. */
function DailyBriefCard({ brief, loading }: { brief: DailyBrief | null; loading: boolean }) {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<"r" | "l">("r");
  const touchX = useRef<number | null>(null);
  // a swipe also fires the click that follows pointerup — swallow that click
  const swiped = useRef(false);
  if (loading && !brief) return <DeckTile><div style={{ fontSize: 13, color: "rgb(var(--dim))" }}>Composing today's brief…</div></DeckTile>;
  if (!brief) return null;
  const hm = HEALTH_META[brief.health];

  type BriefSlide = { eyebrow: string; dot?: string; body: React.ReactNode };
  const lines = (ls: string[]) => ls.map((l, i) => <div key={i} className="bd-line">{l}</div>);
  const y = brief.yesterday.stats;

  /** A figure, laid out as data. `tone` carries meaning without relying on colour. */
  const Fig = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="bd-fig">
      <div className="bd-fig-l">{label}</div>
      <div className="bd-fig-v tnum" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="bd-fig-s">{sub}</div>}
    </div>
  );

  const cards: BriefSlide[] = [
    { eyebrow: "Verdict", dot: hm.color, body: <div className="bd-head">{brief.headline}</div> },
    {
      eyebrow: `Yesterday${brief.yesterday.date ? ` · ${fmtDate(brief.yesterday.date)}` : ""}`,
      body: (
        <div className="bd-figs">
          <Fig label="Sold" value={y.revenue != null ? egp(y.revenue) : "—"} />
          <Fig label="Profit"
            value={y.grossProfit != null && y.grossProfitCovered ? egp(y.grossProfit) : "—"}
            sub={y.grossProfitCovered ? undefined : "needs product costs"} />
          <Fig label="Spent" value={y.expenses != null ? egp(y.expenses) : "—"} />
          <Fig label="Day" value={y.closeStatus === "complete" ? "Closed" : y.closeStatus === "open" ? "Open" : y.closeStatus}
            tone={y.closeStatus === "complete" ? "var(--green)" : "var(--amber)"} />
        </div>
      ),
    },
    { eyebrow: "Today", body: lines(brief.today.lines) },
    {
      eyebrow: "Trust",
      body: (
        <div className="bd-figs">
          <Fig label="Cash" value={brief.trust.cash === "none" ? "Not counted" : brief.trust.cash}
            tone={brief.trust.cash === "none" ? "var(--amber)" : "var(--green)"} />
          <Fig label="Stock" value={brief.trust.inventory === "none" ? "Not counted" : brief.trust.inventory}
            tone={brief.trust.inventory === "none" ? "var(--amber)" : "var(--green)"} />
          <Fig label="Books" value={brief.trust.staleData ? "Behind" : "Current"}
            sub={brief.trust.staleData ?? undefined}
            tone={brief.trust.staleData ? "var(--amber)" : "var(--green)"} />
        </div>
      ),
    },
    ...(brief.today.primaryAction ? [{
      eyebrow: "Do this now",
      dot: "var(--mag)",
      body: (
        <div className="bd-act">
          <Link to={brief.today.primaryAction.screenLink} onClick={(e) => e.stopPropagation()}>{brief.today.primaryAction.title}</Link>
          {" — "}{brief.today.primaryAction.action}
        </div>
      ),
    }] : []),
  ];
  const n = cards.length;
  const at = Math.min(idx, n - 1);
  const go = (next: number, d: "r" | "l") => { setDir(d); setIdx(((next % n) + n) % n); };
  const card = cards[at];

  return (
    <DeckTile>
      <div className="th">
        <span className="tname">Daily brief</span>
        <span style={{ marginLeft: "auto" }}><Chip text={hm.label} color={hm.color} /></span>
      </div>
      <div className="bd-stage">
        {n > 2 && <div className="bd-ghost g2" />}
        {n > 1 && <div className="bd-ghost" />}
        <button type="button" key={at} className={`bd-card in-${dir}`}
          aria-label={`Brief card ${at + 1} of ${n}: ${card.eyebrow}. Activate for the next card.`}
          onClick={() => { if (swiped.current) { swiped.current = false; return; } go(at + 1, "r"); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); go(at + 1, "r"); }
            if (e.key === "ArrowLeft") { e.preventDefault(); go(at - 1, "l"); }
          }}
          onPointerDown={(e) => { if (e.pointerType === "touch") touchX.current = e.clientX; }}
          onPointerUp={(e) => {
            if (touchX.current == null) return;
            const dx = e.clientX - touchX.current; touchX.current = null;
            if (dx < -40) { swiped.current = true; go(at + 1, "r"); }
            else if (dx > 40) { swiped.current = true; go(at - 1, "l"); }
          }}>
          <span className="bd-eyebrow">
            {card.dot && <i style={{ background: card.dot }} />}
            {card.eyebrow}
          </span>
          <div className="bd-body">{card.body}</div>
          <span className="bd-hint">{at + 1}/{n}</span>
        </button>
      </div>
      <div className="bd-nav">
        <button type="button" className="bd-arrow" aria-label="Previous card" onClick={() => go(at - 1, "l")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="bd-dots">
          {cards.map((c, i) => (
            <button type="button" key={i} className="bd-dot" aria-current={i === at}
              aria-label={`Card ${i + 1}: ${c.eyebrow}`} onClick={() => go(i, i > at ? "r" : "l")}>
              <i />
            </button>
          ))}
        </div>
        <button type="button" className="bd-arrow" aria-label="Next card" onClick={() => go(at + 1, "r")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
    </DeckTile>
  );
}

/* ═══ OPERATIONAL EXCEPTIONS (Cycle 9 — canonical model) ══════════════ */

const EXC_COLOR: Record<string, string> = { critical: "var(--red)", high: "var(--amber)", medium: "rgb(var(--violet))", low: "rgb(var(--dim))", info: "rgb(var(--dim))" };

/** Risks & data gaps — folded in from the old "Gaps" tab, so everything that
 *  needs fixing lives with the advice instead of on a separate screen. */
function FixThesePanel() {
  const risksQ = useQuery({ queryKey: ["risk-insights"], queryFn: getRiskInsights, enabled: en });
  const gapsQ = useQuery({ queryKey: ["missing-data"], queryFn: getMissingData, enabled: en });
  const risks = risksQ.data ?? [];
  const gaps = gapsQ.data ?? [];
  if (risksQ.isLoading || gapsQ.isLoading) return <DeckTile><SkeletonRows rows={2} /></DeckTile>;
  if (risks.length === 0 && gaps.length === 0) return null;

  const sevColor = (s: string) => s === "critical" || s === "high" ? "var(--red)" : s === "warning" || s === "medium" ? "var(--amber)" : "rgb(var(--dim))";
  return (
    <DeckTile>
      <div className="th"><span className="tname">Worth fixing</span>
        <span className="sp-badge" style={{ marginLeft: "auto" }}>{risks.length + gaps.length}</span>
      </div>
      <div className="space-y-2" style={{ marginTop: 8 }}>
        {risks.map((r) => (
          <Link key={r.key} to={r.route} className="fix-row">
            <span className="fix-dot" style={{ background: sevColor(r.severity) }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="fix-t">{r.title}{r.metric && <span className="fix-m tnum">{r.metric}</span>}</div>
              <div className="fix-d">{r.detail}</div>
              <div className="fix-a">→ {r.action}</div>
            </div>
          </Link>
        ))}
        {gaps.map((g) => (
          <Link key={g.key} to={g.route} className="fix-row">
            <span className="fix-dot" style={{ background: sevColor(g.severity) }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="fix-t">{g.title}<span className="fix-m tnum">{g.count}</span></div>
              <div className="fix-d">{g.detail}</div>
              <div className="fix-a">→ {g.action}</div>
            </div>
          </Link>
        ))}
      </div>
    </DeckTile>
  );
}

function OperationalExceptionsPanel({ exceptions, loading, onAck, onDismiss }: {
  exceptions: ReconciledException[]; loading: boolean;
  onAck: (id: string) => Promise<void>; onDismiss: (id: string, reason: string) => Promise<void>;
}) {
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (loading && !exceptions.length) return null;
  if (!exceptions.length) {
    return <DeckTile><div className="th"><span className="tname">Operational exceptions</span><span style={{ marginLeft: "auto" }}><Chip text="all clear" color="var(--green)" /></span></div>
      <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", marginTop: 8 }}>No open operational issues.</div></DeckTile>;
  }
  return (
    <DeckTile>
      <div className="th"><span className="tname">Operational exceptions</span>
        <span style={{ marginLeft: "auto" }}><Chip text={`${exceptions.length} open`} color={EXC_COLOR[exceptions[0].severity]} /></span>
      </div>
      <div className="space-y-2" style={{ marginTop: 10 }}>
        {exceptions.map((e) => (
          <div key={e.id} style={{ border: "1px solid var(--stroke2)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "rgb(var(--text))" }}>{e.title}</span>
              <Chip text={e.severity} color={EXC_COLOR[e.severity]} />
              {e.status !== "open" && <Chip text={e.status} color="rgb(var(--dim))" />}
              {e.recurrenceCount > 1 && <Chip text={`×${e.recurrenceCount}`} color="rgb(var(--dim))" />}
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <Link to={e.screenLink} className="mbtn">Fix</Link>
                {e.status === "open" && <button className="mbtn" onClick={() => void onAck(e.id)}>Ack</button>}
                <button className="mbtn" onClick={() => { setDismissing(dismissing === e.id ? null : e.id); setReason(""); }}>Dismiss</button>
              </span>
            </div>
            <div style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 4 }}>{e.detail}</div>
            <div style={{ fontSize: 12, color: "rgb(var(--dim))", marginTop: 3 }}>→ {e.resolutionAction}</div>
            {dismissing === e.id && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <Input placeholder="Reason (required)" value={reason} onChange={(ev) => setReason(ev.target.value)} style={{ maxWidth: 260 }} />
                <button className="mbtn" disabled={!reason.trim()} onClick={async () => { await onDismiss(e.id, reason.trim()); setDismissing(null); }}>Confirm</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </DeckTile>
  );
}

/* ═══ SALES CATCH-UP WORKSPACE (Cycle 9 candidate, built Cycle 13) ═════ */

const GAP_META: Record<SalesGap["kind"], { label: string; color: string; action: string; screenLink: string }> = {
  missing: { label: "missing", color: "var(--red)", action: "Enter or import", screenLink: "/sales" },
  total_only: { label: "no product detail", color: "var(--amber)", action: "Add product lines", screenLink: "/sales/product-lines" },
  awaiting_import: { label: "awaiting import", color: "rgb(var(--cyan))", action: "Review import", screenLink: "/sales/import" },
};
const GAP_ORDER: SalesGap["kind"][] = ["missing", "total_only", "awaiting_import"];

/** A scannable, recent-first catch-up list over the (previously built but
 *  never surfaced) detectSalesGaps engine — one place to see and jump to
 *  every day that needs entering, product-line detail, or import review. */
function SalesCatchUpWorkspace({ gaps, loading }: { gaps: SalesGap[]; loading: boolean }) {
  const [filter, setFilter] = useState<SalesGap["kind"] | "all">("all");
  if (loading && !gaps.length) return null;
  if (!gaps.length) {
    return (
      <DeckTile>
        <div className="th"><span className="tname">Sales catch-up</span><span style={{ marginLeft: "auto" }}><Chip text="current" color="var(--green)" /></span></div>
        <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", marginTop: 8 }}>No gaps in the last 30 days.</div>
      </DeckTile>
    );
  }
  const counts = GAP_ORDER.map((k) => ({ kind: k, n: gaps.filter((g) => g.kind === k).length })).filter((c) => c.n > 0);
  const shown = filter === "all" ? gaps : gaps.filter((g) => g.kind === filter);
  return (
    <DeckTile>
      <div className="th"><span className="tname">Sales catch-up</span>
        <span style={{ marginLeft: "auto" }}><Chip text={`${gaps.length} day${gaps.length === 1 ? "" : "s"}`} color={GAP_META.missing.color} /></span>
      </div>
      <div className="chiprow" style={{ margin: "10px 0" }}>
        <button className={filter === "all" ? "mbtn on" : "mbtn"} onClick={() => setFilter("all")}>All</button>
        {counts.map((c) => (
          <button key={c.kind} className={filter === c.kind ? "mbtn on" : "mbtn"} onClick={() => setFilter(c.kind)}>{GAP_META[c.kind].label} · {c.n}</button>
        ))}
      </div>
      <div className="space-y-1" style={{ maxHeight: 260, overflowY: "auto" }}>
        {shown.slice(0, 60).map((g) => {
          const meta = GAP_META[g.kind];
          return (
            <div key={g.date} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px", borderTop: "1px solid var(--stroke2)" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "rgb(var(--text))", minWidth: 88 }}>{fmtDate(g.date)}</span>
              <Chip text={meta.label} color={meta.color} />
              <Link to={meta.screenLink} className="mbtn" style={{ marginLeft: "auto" }}>{meta.action}</Link>
            </div>
          );
        })}
        {shown.length > 60 && <div style={{ fontSize: 11.5, color: "rgb(var(--faint))", padding: "6px 2px" }}>+{shown.length - 60} more — use a filter to narrow.</div>}
      </div>
    </DeckTile>
  );
}

/* ═══ OWNER KNOWLEDGE INTERVIEW (Cycle 11) ═══════════════════════════ */

const QUESTION_FIELD: Record<string, string> = {
  allowed_promotions: "allowedPromotions", allowed_display_changes: "allowedDisplayChanges",
  occasions: "customerOccasions", operational_constraints: "operationalConstraints",
};

function OwnerInterviewCard({ data, onMarkUnknown, onAnswerList, onOpenSetup }: {
  data: { questions: PendingQuestion[]; progress: { total: number; answered: number; pct: number } } | null;
  onMarkUnknown: (id: string) => Promise<void>;
  onAnswerList: (id: string, field: string, values: string[]) => Promise<void>;
  onOpenSetup: () => void;
}) {
  const [draftText, setDraftText] = useState<Record<string, string>>({});
  if (!data || data.questions.length === 0) {
    if (!data) return null;
    return (
      <DeckTile>
        <div className="th"><span className="tname">Owner knowledge</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <Chip text={`${data.progress.pct}% complete`} color="var(--green)" />
            <button className="mbtn" onClick={onOpenSetup}>Edit stand</button>
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", marginTop: 8 }}>Answers make merchandising and packaging advice specific to your stand.</div>
      </DeckTile>
    );
  }
  return (
    <DeckTile>
      <div className="th"><span className="tname">A few things only you know</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <Chip text={`${data.progress.answered}/${data.progress.total}`} color="rgb(var(--dim))" />
          <button className="mbtn" onClick={onOpenSetup}>Set up my stand</button>
        </span>
      </div>
      <div style={{ fontSize: 12, color: "rgb(var(--faint))", margin: "6px 0 10px" }}>Makes advice specific to your stand — BostaOS never guesses this.</div>
      <div className="space-y-2">
        {data.questions.map((q) => {
          const field = QUESTION_FIELD[q.id];
          return (
            <div key={q.id} style={{ border: "1px solid var(--stroke2)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3, color: "rgb(var(--faint))" }}>{q.section}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "rgb(var(--text))", marginTop: 2 }}>{q.question}</div>
              <div style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 4 }}>{q.why}</div>
              <div style={{ fontSize: 11.5, color: "rgb(var(--faint))", marginTop: 3 }}>Unlocks: {q.unlocks.join(" · ")}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                {field ? (
                  <>
                    <Input placeholder="comma-separated" value={draftText[q.id] ?? ""} onChange={(e) => setDraftText({ ...draftText, [q.id]: e.target.value })} style={{ maxWidth: 280 }} />
                    <button className="mbtn" disabled={!draftText[q.id]?.trim()} onClick={() => void onAnswerList(q.id, field, draftText[q.id].split(",").map((x) => x.trim()).filter(Boolean))}>Save</button>
                  </>
                ) : (
                  <Link to={q.screenLink} className="mbtn">Answer in {q.screenLink.replace("/", "")}</Link>
                )}
                {q.allowUnknown && <button className="mbtn" onClick={() => void onMarkUnknown(q.id)}>Unknown / skip</button>}
              </div>
            </div>
          );
        })}
      </div>
    </DeckTile>
  );
}

/* ═══ STAND SETUP — finish the interview loop (Cycle 12) ═════════════ */

const SELECT_STYLE: React.CSSProperties = { background: "var(--surface2)", color: "rgb(var(--text))", border: "1px solid var(--stroke)", borderRadius: 8, padding: "5px 7px", fontSize: 12 };
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function RetailSetupModal({ open, onClose, onSaved, onError }: { open: boolean; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const qc = useQueryClient();
  const prodQ = useQuery({ queryKey: ["retail-setup-products"], queryFn: listProductsForContext, enabled: open });
  const pkgQ = useQuery({ queryKey: ["retail-setup-packaging"], queryFn: listPackagingFormats, enabled: open });
  const [pkg, setPkg] = useState({ name: "", type: "mini_bag", packSizeG: "", packageCost: "", prepCost: "", labelSealCost: "" });

  const saveProd = async (id: string, patch: Parameters<typeof setProductContext>[1]) => {
    try { await setProductContext(id, patch); qc.invalidateQueries({ queryKey: ["retail-setup-products"] }); onSaved(); }
    catch (e) { onError(e); }
  };
  const addPkg = async () => {
    try {
      await createPackagingFormat({
        name: pkg.name.trim(), packagingType: pkg.type, material: null, packSizeG: numOrNull(pkg.packSizeG),
        packageCost: numOrNull(pkg.packageCost), prepCost: numOrNull(pkg.prepCost), labelSealCost: numOrNull(pkg.labelSealCost),
        prepMinutes: null, premiumScore: null, impulseSuitable: pkg.type === "mini_bag" || pkg.type === "grab_and_go",
        giftingSuitable: pkg.type === "gift" || pkg.type === "pouch", shelfSpace: null, displayZone: null,
        seasonal: false, season: null, applicableProductIds: [], active: true,
      });
      setPkg({ name: "", type: "mini_bag", packSizeG: "", packageCost: "", prepCost: "", labelSealCost: "" });
      qc.invalidateQueries({ queryKey: ["retail-setup-packaging"] }); onSaved();
    } catch (e) { onError(e); }
  };

  const products = prodQ.data ?? [];
  return (
    <Modal open={open} onClose={onClose} title="Set up my stand" wide>
      <div style={{ fontSize: 12.5, color: "rgb(var(--muted))", marginBottom: 12 }}>
        How your stand is merchandised and packaged. Asked once — makes advice specific.
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3, color: "rgb(var(--faint))", marginBottom: 6 }}>Packaging formats you offer</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <Input placeholder="Name (e.g. 150g mini)" value={pkg.name} onChange={(e) => setPkg({ ...pkg, name: e.target.value })} style={{ maxWidth: 150 }} />
        <select value={pkg.type} onChange={(e) => setPkg({ ...pkg, type: e.target.value })} style={SELECT_STYLE}>
          {["weighted", "prepacked", "mini_bag", "grab_and_go", "pouch", "gift", "sampling"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Input placeholder="g" value={pkg.packSizeG} onChange={(e) => setPkg({ ...pkg, packSizeG: e.target.value })} style={{ maxWidth: 60 }} />
        <Input placeholder="pkg cost" value={pkg.packageCost} onChange={(e) => setPkg({ ...pkg, packageCost: e.target.value })} style={{ maxWidth: 80 }} />
        <Input placeholder="prep" value={pkg.prepCost} onChange={(e) => setPkg({ ...pkg, prepCost: e.target.value })} style={{ maxWidth: 60 }} />
        <Input placeholder="label/seal" value={pkg.labelSealCost} onChange={(e) => setPkg({ ...pkg, labelSealCost: e.target.value })} style={{ maxWidth: 80 }} />
        <button className="mbtn" disabled={!pkg.name.trim()} onClick={() => void addPkg()}>Add</button>
      </div>
      {(pkgQ.data ?? []).length > 0 && (
        <div style={{ fontSize: 12, color: "rgb(var(--dim))", marginBottom: 14 }}>
          Offered: {(pkgQ.data ?? []).map((f) => `${f.name} (${f.packagingType})`).join(" · ")}
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3, color: "rgb(var(--faint))", margin: "6px 0" }}>Per-product stand facts</div>
      <div style={{ maxHeight: "40vh", overflowY: "auto", overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 540, fontSize: 12, borderCollapse: "collapse" }}>
          <thead><tr style={{ color: "rgb(var(--faint))", textAlign: "left" }}>
            <th style={{ padding: "4px 6px" }}>Product</th><th>Facings</th><th>Zone</th><th>Tier</th><th>Traffic</th><th>Keep</th>
          </tr></thead>
          <tbody>
            {products.map((p) => <SetupRow key={p.id} p={p} onSave={saveProd} />)}
          </tbody>
        </table>
        {prodQ.isLoading && <div style={{ fontSize: 12, color: "rgb(var(--dim))", padding: 8 }}>Loading products…</div>}
      </div>
      <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}><Button onClick={onClose}>Done</Button></div>
    </Modal>
  );
}

function SetupRow({ p, onSave }: { p: ProductContextRow; onSave: (id: string, patch: Parameters<typeof setProductContext>[1]) => Promise<void> }) {
  const [facings, setFacings] = useState(p.facings == null ? "" : String(p.facings));
  return (
    <tr style={{ borderTop: "1px solid var(--stroke2)" }}>
      <td style={{ padding: "4px 6px", color: "rgb(var(--text))" }}>{p.name}</td>
      <td><Input value={facings} onChange={(e) => setFacings(e.target.value)} onBlur={() => void onSave(p.id, { facings: numOrNull(facings) })} style={{ maxWidth: 52, padding: "4px 6px" }} /></td>
      <td>
        <select defaultValue={p.displayZone ?? ""} onChange={(e) => void onSave(p.id, { displayZone: e.target.value || null })} style={SELECT_STYLE}>
          <option value="">—</option>{["entrance", "counter", "aisle", "premium_block"].map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </td>
      <td>
        <select defaultValue={p.tier ?? ""} onChange={(e) => void onSave(p.id, { tier: (e.target.value || null) as "premium" | "standard" | "value" | null })} style={SELECT_STYLE}>
          <option value="">—</option>{["premium", "standard", "value"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td style={{ textAlign: "center" }}><input type="checkbox" defaultChecked={p.isTrafficDriver} onChange={(e) => void onSave(p.id, { isTrafficDriver: e.target.checked })} /></td>
      <td style={{ textAlign: "center" }}><input type="checkbox" defaultChecked={p.doNotDiscontinue} onChange={(e) => void onSave(p.id, { doNotDiscontinue: e.target.checked })} /></td>
    </tr>
  );
}

/* ═══ RETAIL ADVISOR — "What I would do" (Cycle 10) ═══════════════════ */

/** Strips the currency prefix for the hero figure, which carries its own. */
const bareEgp = (n: number) => egp(n).replace("EGP ", "");

const FILTER_BUCKET: Record<string, string> = {
  merchandising: "Merchandising", shelf: "Merchandising", packaging: "Packaging",
  pricing: "Pricing", margin: "Pricing", purchase: "Purchasing", supplier: "Purchasing",
  category: "Portfolio", growth: "Portfolio", risk: "Portfolio", recommendation: "Portfolio", decision: "Portfolio",
  promotion: "Promotions", cash: "Cash", cheque: "Cash",
  inventory: "Operations", operational: "Operations", revenue: "Operations", seasonality: "Operations", basket: "Operations",
};

function RetailAdvisor({ result, loading, onExperiment }: {
  result: RetailResult | null;
  loading: boolean;
  onExperiment: (r: RetailRecommendation) => Promise<void>;
}) {
  const [filter, setFilter] = useState<string>("All");
  const [openId, setOpenId] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  if (loading && !result) return <DeckTile><div style={{ fontSize: 13, color: "rgb(var(--dim))" }}>Reasoning over your books…</div></DeckTile>;
  if (!result) return null;
  const recs = result.recommendations;
  const buckets = ["All", ...Array.from(new Set(recs.map((r) => FILTER_BUCKET[r.domain] ?? "Operations")))];
  const shown = (filter === "All" ? recs : recs.filter((r) => (FILTER_BUCKET[r.domain] ?? "Operations") === filter));

  const o = result.objective;
  return (
    <DeckTile>
      <div className="th"><span className="tname">What I would do</span>
        {recs.length > 0 && <span className="sp-badge" style={{ marginLeft: "auto" }}>{recs.length}</span>}
      </div>

      {recs.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", marginTop: 8 }}>
          Nothing to change today — the stand and the numbers both look right.
        </div>
      ) : (
        <>
          {/* THE PRIZE — the size of the whole list, before reading any of it */}
          {o.totalEgp > 0 && (
            <div className="wid-prize">
              <div className="wid-prize-v tnum"><small>EGP</small>{bareEgp(o.totalEgp)}</div>
              <div className="wid-prize-l">a month if you do all of it</div>
              <div className="wid-prize-split">
                {o.revenueUpsideEgp > 0 && <span><i style={{ background: "var(--green)" }} />{egp(o.revenueUpsideEgp)} more sales</span>}
                {o.costSavingEgp > 0 && <span><i style={{ background: "rgb(var(--cyan))" }} />{egp(o.costSavingEgp)} less cost</span>}
              </div>
            </div>
          )}

          <div className="chiprow" style={{ margin: "12px 0 10px" }}>
            {buckets.map((b) => (
              <button key={b} className={filter === b ? "mbtn on" : "mbtn"} onClick={() => setFilter(b)}>{b}</button>
            ))}
          </div>

          <div className="space-y-2">
            {shown.map((r) => {
              const open = openId === r.id;
              return (
                <div key={r.id} className={cn("wid-row", open && "open")}>
                  <button type="button" className="wid-head" onClick={() => setOpenId(open ? null : r.id)}>
                    <span className="wid-worth tnum">
                      {r.expectedMonthlyEgp >= 13
                        ? <><b>{egp(r.expectedMonthlyEgp)}</b><small>/month</small></>
                        : <em>worth doing</em>}
                    </span>
                    <span className="wid-title">{r.title}</span>
                    <svg className="wid-ch" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                      strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none" }} aria-hidden>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  {!open && <div className="wid-do">{r.proposedAction}</div>}

                  {open && (
                    <div style={{ marginTop: 8, fontSize: 12.5, color: "rgb(var(--muted))" }}>
                      <div className="wid-do" style={{ marginTop: 0 }}>{r.proposedAction}</div>
                      {r.impact && (
                        <div className="wid-basis">
                          <b>{egp(r.impact.monthlyEgp)}/month</b> — {r.impact.basis}.
                          {r.expectedMonthlyEgp < r.impact.monthlyEgp && (
                            <> Ranked at {egp(r.expectedMonthlyEgp)} after allowing for how sure this is.</>
                          )}
                        </div>
                      )}
                      <AdviceBlock label="Why" lines={[...r.observedFacts, ...r.reasoning]} />
                      <AdviceBlock label="How" lines={r.implementationSteps.length ? r.implementationSteps : [r.proposedAction]} />
                      {r.testDesign && <AdviceBlock label="How you'll know" lines={[r.testDesign, ...r.successCriteria.map((c) => `Works if: ${c}`)]} />}
                      <AdviceBlock label="Watch out for" lines={[...r.risks, ...r.contraindications]} />
                      {r.sharpenWith && <div className="wid-sharpen">Sharper with: {r.sharpenWith}</div>}
                      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Link to={r.screenLink} className="mbtn">Open screen</Link>
                        {r.truthLevel === "experiment_hypothesis" && <button className="mbtn" onClick={() => void onExperiment(r)}>Track as a test</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* certainty is disclosed here, once — never used to withhold advice */}
          {result.facts.basisNote && result.facts.basisNote !== "full coverage" && (
            <div className="wid-foot">
              <button type="button" className="aq-more" onClick={() => setWhy((v) => !v)}>{why ? "Hide" : "How sure is this?"}</button>
              {why && <div style={{ marginTop: 6, lineHeight: 1.5 }}>Advice above is ranked on what it earns. Sharper once: {result.facts.basisNote}.</div>}
            </div>
          )}
        </>
      )}
    </DeckTile>
  );
}

function AdviceBlock({ label, lines }: { label: string; lines: string[] }) {
  const clean = lines.filter(Boolean);
  if (!clean.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: "rgb(var(--faint))" }}>{label}</div>
      <ul style={{ margin: "2px 0 0", paddingLeft: 16 }}>
        {clean.map((l, i) => <li key={i} style={{ fontSize: 12.5, color: "rgb(var(--muted))" }}>{l}</li>)}
      </ul>
    </div>
  );
}

/* ═══ EXECUTIVE BRIEFING ══════════════════════════════════════════════ */

function ExecutiveBriefing({ s, report, weekly }: { s: StrategistSnapshot; report: StrategyReport; weekly: ReturnType<typeof selectWeeklyPriority> }) {
  const { reportError } = useUI();
  const findings = report.findings;
  const [ai, setAi] = useState<{ response: StrategistResponse; cached: boolean; snapshotLabel: string; provider?: string; fallbackReason?: string } | null>(null);
  const [aiState, setAiState] = useState<"idle" | "loading">("idle");
  const loadedCache = useRef(false);

  // load a cached briefing once (no API spend); label it with its snapshot
  useEffect(() => {
    if (loadedCache.current) return;
    loadedCache.current = true;
    getCachedBriefing().then((c) => {
      if (c) setAi({ response: c.response, cached: true, snapshotLabel: `${c.snapshotMeta.period} · books to ${c.snapshotMeta.lastDataDate ?? "—"}` });
    }).catch(() => undefined);
  }, []);

  const generate = async () => {
    setAiState("loading");
    try {
      const result: LanguageResult = await generateLanguage(
        { mode: "daily_brief", snapshot: s, report, findings, calendar: computeCalendar(todayCairo()), weeklyPriority: weekly },
        { enhanced: true },
      );
      if (result.fallback) timings.fallbacks += 1;
      timings.lastLanguageMs = result.latencyMs;
      timings.validationRepairs += result.validation.repaired.length;
      const meta = { generatedAt: new Date().toISOString(), period: s.meta.period.label, lastDataDate: s.meta.lastDataDate };
      setAi({
        response: result.response, cached: false,
        snapshotLabel: `${meta.period} · books to ${meta.lastDataDate ?? "—"}`,
        provider: result.provider, fallbackReason: result.fallbackReason,
      });
      setAiState("idle");
      if (!result.fallback && result.provider !== "deterministic") {
        await saveCachedBriefing({ response: result.response, snapshotMeta: meta, generatedAt: meta.generatedAt });
      }
    } catch (e) {
      setAiState("idle");
      reportError("Strategist", e); // only auth errors reach here — everything else falls back
    }
  };

  // deterministic briefing pieces — always available
  const top = findings[0];
  const risk = findings.find((f) => f.class === "warning" || f.class === "contradiction" || f.class === "decision_risk");
  const opp = findings.find((f) => f.class === "opportunity");
  const dataIssue = findings.find((f) => f.class === "data_quality");
  const urgentAction = findings.find((f) => f.action && (f.urgency === "today" || f.urgency === "this_week"))?.action;

  const cacheIsStale = !!ai?.cached && !ai.snapshotLabel.startsWith(s.meta.period.label);

  return (
    <DeckTile>
      <div className="th">
        <span className="tname">Executive briefing</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {ai && ai.provider !== "deterministic" && !ai.fallbackReason
            ? <Chip text={ai.cached ? "Enhanced · cached" : "Enhanced"} color="rgb(var(--cyan))" />
            : <Chip text="BostaOS analysis" color="rgb(var(--violet))" />}
          <Button onClick={() => void generate()} disabled={aiState === "loading"}>
            {aiState === "loading" ? "Working…" : ai ? "Refresh enhanced briefing" : "Enhanced briefing"}
          </Button>
        </span>
      </div>

      {ai?.fallbackReason && (
        <div style={{ margin: "10px 0", fontSize: 12.5, color: "var(--amber)", fontWeight: 600 }}>
          Language service unavailable — BostaOS templates wrote this briefing. ({ai.fallbackReason}) Nothing retries automatically.
        </div>
      )}
      {ai && cacheIsStale && (
        <div style={{ margin: "10px 0", fontSize: 12, color: "rgb(var(--dim))" }}>
          This AI briefing came from an earlier snapshot ({ai.snapshotLabel}). The findings below are current.
        </div>
      )}

      {ai ? (
        <div style={{ marginTop: 10 }}>
          <div className="disp" style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.35 }}>{ai.response.headline}</div>
          <p style={{ marginTop: 8, fontSize: 13.5, color: "rgb(var(--muted))", lineHeight: 1.6 }}>{ai.response.conclusion}</p>
          {ai.response.dataLimitations.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "rgb(var(--dim))" }}>Limits: {ai.response.dataLimitations.join(" · ")}</div>
          )}
        </div>
      ) : top ? (
        <div style={{ marginTop: 10 }}>
          <div className="disp" style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.35 }}>{top.title}</div>
          <p style={{ marginTop: 8, fontSize: 13.5, color: "rgb(var(--muted))", lineHeight: 1.6 }}>{top.detail}</p>
        </div>
      ) : (
        <p style={{ marginTop: 10, fontSize: 13.5, color: "rgb(var(--dim))" }}>No findings — the books look steady for {s.meta.period.label}.</p>
      )}

      {report.revenueContribution.available && (report.revenueContribution.positive.length > 0 || report.revenueContribution.negative.length > 0) && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: "rgb(var(--muted))", lineHeight: 1.55 }}>
          <span style={{ color: "rgb(var(--faint))", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.5 }}>Root cause · </span>
          {(report.revenueContribution.totalChange >= 0 ? report.revenueContribution.positive : report.revenueContribution.negative).slice(0, 3)
            .map((d) => `${d.name} (${d.delta >= 0 ? "+" : "−"}${egp(Math.abs(d.delta))})`).join(" · ")}
          {report.revenueContribution.explainedPct != null && <span style={{ color: "rgb(var(--dim))" }}> — explains {report.revenueContribution.explainedPct}% of the revenue change{report.revenueContribution.unexplained !== 0 ? `; ${egp(Math.abs(report.revenueContribution.unexplained))} on days without product detail` : ""}</span>}
        </div>
      )}
      {!report.revenueContribution.available && report.revenueContribution.reason && (
        <div style={{ marginTop: 12, fontSize: 12, color: "rgb(var(--dim))" }}>Root-cause attribution unavailable: {report.revenueContribution.reason}.</div>
      )}

      {/* deterministic status row — always shown, AI or not */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 16 }}>
        {risk && <BriefCell label="Top risk" text={risk.title} color="var(--amber)" />}
        {opp && <BriefCell label="Opportunity" text={opp.title} color="var(--green)" />}
        {dataIssue && <BriefCell label="Data issue" text={dataIssue.title} color="rgb(var(--violet))" />}
        {urgentAction && <BriefCell label="Most urgent action" text={urgentAction.action} color="var(--mag)" />}
      </div>
    </DeckTile>
  );
}

function BriefCell({ label, text, color }: { label: string; text: string; color: string }) {
  return (
    <div style={{ borderLeft: `2px solid ${color}`, paddingLeft: 10 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "rgb(var(--faint))" }}>{label}</div>
      <div style={{ fontSize: 12.5, color: "rgb(var(--text))", marginTop: 3, lineHeight: 1.45 }}>{text}</div>
    </div>
  );
}

/* ═══ WHAT MATTERS NOW ════════════════════════════════════════════════ */


function WhatMattersNow({ findings, insightByFinding, onEvidence, onStatus, onAccept }: {
  findings: Finding[];
  insightByFinding: Map<string, InsightRow>;
  onEvidence: (f: Finding) => void;
  onStatus: (row: InsightRow, status: "acknowledged" | "dismissed") => Promise<void>;
  onAccept: (f: Finding) => Promise<void>;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? findings : findings.slice(0, 3);
  return (
    <DeckTile>
      <div className="th"><span className="tname">What matters now</span>
        <span className="eyebrow" style={{ marginLeft: "auto" }}>{findings.length} finding(s) · ranked by impact</span>
      </div>
      <div className="space-y-3" style={{ marginTop: 10 }}>
        {visible.map((f) => {
          const meta = CLASS_META[f.class];
          const row = insightByFinding.get(f.id);
          return (
            <div key={f.id} style={{ border: "1px solid var(--stroke2)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "rgb(var(--faint))" }}>#{f.rank}</span>
                <Chip text={meta.label} color={meta.color} />
                <Chip text={URGENCY_LABEL[f.urgency]} color={f.urgency === "today" ? "var(--red)" : "rgb(var(--dim))"} />
                <Chip text={CONF_LABEL[f.confidence]} color="rgb(var(--dim))" />
                {f.impactEgp != null && f.impactEgp > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "rgb(var(--text))" }}>{egp(f.impactEgp)} at stake</span>}
                {row && row.seenCount > 1 && <span style={{ fontSize: 11, color: "rgb(var(--faint))" }}>seen {row.seenCount}× since {fmtDate(row.firstSeenAt.slice(0, 10))}</span>}
              </div>
              <div className="disp" style={{ fontSize: 15, fontWeight: 700, marginTop: 8 }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: "rgb(var(--muted))", marginTop: 4, lineHeight: 1.5 }}>{f.detail}</div>
              {f.evidence[0] && (
                <button onClick={() => onEvidence(f)} style={{ marginTop: 8, fontSize: 12, color: "rgb(var(--cyan))", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  {f.evidence[0].label}: {f.evidence[0].value} · see all evidence →
                </button>
              )}
              {f.missingData.length > 0 && (
                <div style={{ fontSize: 11.5, color: "rgb(var(--dim))", marginTop: 6 }}>Missing: {f.missingData.join(" · ")}</div>
              )}
              {f.action && (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, color: "rgb(var(--text))", fontWeight: 600 }}>→ {f.action.action}</span>
                  <Link to={f.action.screenLink} style={{ fontSize: 12, color: "var(--mag)", fontWeight: 700 }}>Open screen</Link>
                  <button className="addbtn" style={{ fontSize: 11.5, padding: "3px 10px" }} onClick={() => void onAccept(f)}>+ Queue action</button>
                </div>
              )}
              {row && (row.status === "active" || row.status === "reopened") && (
                <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
                  <button className="mbtn" onClick={() => void onStatus(row, "acknowledged")}>Acknowledge</button>
                  <button className="mbtn" onClick={() => void onStatus(row, "dismissed")}>Dismiss</button>
                  {row.status === "reopened" && <Chip text="Returned after being resolved" color="var(--amber)" />}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {findings.length > 3 && (
        <button className="mbtn" style={{ marginTop: 12 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show top 3 only" : `Show all ${findings.length} findings`}
        </button>
      )}
    </DeckTile>
  );
}

/* ═══ EVIDENCE DRAWER ═════════════════════════════════════════════════ */

function EvidenceDrawer({ finding, onClose }: { finding: Finding | null; onClose: () => void }) {
  return (
    <Sheet open={!!finding} onClose={onClose} title="Evidence">
      {finding && (
        <div className="space-y-3">
          <div className="disp" style={{ fontSize: 15, fontWeight: 700 }}>{finding.title}</div>
          <div style={{ fontSize: 12.5, color: "rgb(var(--muted))", lineHeight: 1.55 }}>
            <span style={{ color: "rgb(var(--faint))", fontWeight: 700 }}>Why this was raised: </span>{finding.detail}
          </div>
          {finding.evidence.map((e, i) => (
            <div key={i} style={{ border: "1px solid var(--stroke2)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{e.label}</span>
                <span className="tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "rgb(var(--text))" }}>{e.value}</span>
              </div>
              <div style={{ fontSize: 11.5, color: "rgb(var(--dim))", marginTop: 4 }}>
                {ownerSource(e.source)} · {e.period}
              </div>
              <Link to={e.screenLink} style={{ fontSize: 11.5, color: "var(--mag)", fontWeight: 700 }}>Inspect on screen →</Link>
            </div>
          ))}
          {finding.missingData.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--amber)" }}>
              Would be stronger with: {finding.missingData.join(" · ")}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "rgb(var(--faint))" }}>
            {CONF_LABEL[finding.confidence]} · {finding.impactEgp != null ? `${egp(finding.impactEgp)} estimated at stake` : "impact not quantified"}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* ═══ ACTION QUEUE ════════════════════════════════════════════════════ */

function ActionQueue({ actions, onUpdate }: { actions: ActionRow[]; onUpdate: (id: string, status: string, note?: string) => Promise<void> }) {
  const { reportError, reportSuccess } = useUI();
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const open = actions.filter((a) => ["suggested", "accepted", "in_progress"].includes(a.status));
  const done = actions.filter((a) => a.status === "completed").slice(0, 3);

  const addOwn = async () => {
    if (!newTitle.trim()) return;
    try {
      await createAction({ title: newTitle.trim(), source: "owner", status: "accepted" });
      setNewTitle(""); reportSuccess("Action queue", "Added");
      qc.invalidateQueries({ queryKey: ["strategist-actions"] });
    } catch (e) { reportError("Action queue", e); }
  };

  return (
    <DeckTile>
      <div className="th"><span className="tname">Action queue</span>
        <span className="eyebrow" style={{ marginLeft: "auto" }}>{open.length} open</span>
      </div>
      {open.length === 0 && <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", marginTop: 8 }}>Nothing queued. Accept an action above or add your own.</div>}
      <div className="space-y-2" style={{ marginTop: 8 }}>
        {open.map((a) => (
          <div key={a.id} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", border: "1px solid var(--stroke2)", borderRadius: 10, padding: "9px 12px" }}>
            <Chip text={a.priority} color={a.priority === "high" ? "var(--red)" : a.priority === "medium" ? "var(--amber)" : "rgb(var(--dim))"} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{a.title}</div>
              {a.description && <div style={{ fontSize: 11.5, color: "rgb(var(--dim))" }}>{a.description}</div>}
              <div style={{ fontSize: 10.5, color: "rgb(var(--faint))" }}>{a.source === "owner" ? "yours" : `from ${a.source}`} · {fmtDate(a.createdAt.slice(0, 10))}{a.dueDate ? ` · due ${fmtDate(a.dueDate)}` : ""}{a.reviewDate ? ` · outcome review ${fmtDate(a.reviewDate)}` : ""}</div>
              {a.outcomeState !== "not_started" && <div style={{ marginTop: 3 }}><Chip text={a.outcomeState.replace(/_/g, " ")} color={a.outcomeState === "improved" ? "var(--green)" : a.outcomeState === "worsened" ? "var(--red)" : "rgb(var(--dim))"} /></div>}
            </div>
            <Link to={a.screenLink} style={{ fontSize: 11.5, color: "var(--mag)", fontWeight: 700 }}>Open</Link>
            {a.status !== "in_progress" && <button className="mbtn" onClick={() => void onUpdate(a.id, "in_progress")}>Start</button>}
            <button className="mbtn" onClick={() => void onUpdate(a.id, "completed")}>Done</button>
            <button className="mbtn" style={{ color: "rgb(var(--faint))" }} onClick={() => void onUpdate(a.id, "dismissed")}>Dismiss</button>
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: "rgb(var(--faint))" }}>
          Recently completed: {done.map((a) => a.title).join(" · ")}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Input placeholder="Add your own action…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void addOwn(); }} />
        <Button onClick={() => void addOwn()}>Add</Button>
      </div>
    </DeckTile>
  );
}

/* ═══ ASK THE STRATEGIST ══════════════════════════════════════════════ */

type DecisionKind = "withdrawal" | "stock" | "employee";

const DECISION_META: Record<DecisionKind, { chip: string; ask: string }> = {
  withdrawal: { chip: "Take money out", ask: "How much? e.g. 20000" },
  stock: { chip: "Buy stock", ask: "Purchase amount, e.g. 15000" },
  employee: { chip: "Hire someone", ask: "Monthly salary, e.g. 6000" },
};

const VERDICT_META: Record<string, [string, string]> = {
  safe: ["Affordable", "var(--green)"], safe_reduces_flexibility: ["Affordable · thins the buffer", "var(--green)"],
  conditional: ["Conditional on expected money", "var(--amber)"], tight: ["Possible but tight", "var(--amber)"],
  unsafe: ["Not safely affordable", "var(--red)"], unknowable: ["Can't be verified yet", "rgb(var(--violet))"],
};

/** ONE surface for talking to the strategist: free questions AND decisions.
 *  A decision chip morphs the same composer into an amount field whose verdict
 *  computes live from the engine; "Judgment" adds the AI's view on top. */
function AskDecide({ s, report, actions, insights, brief, exceptions }: {
  s: StrategistSnapshot; report: StrategyReport; actions: ActionRow[]; insights: InsightRow[];
  brief: DailyBrief | null; exceptions: ReconciledException[];
}) {
  const { reportError } = useUI();
  const qc = useQueryClient();
  const findings = report.findings;
  const [input, setInput] = useState("");
  const [convId, setConvId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionKind | null>(null);
  const [amount, setAmount] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<{ r: StrategistResponse; note?: string } | null>(null);
  const [aiState, setAiState] = useState<"idle" | "loading">("idle");

  /** Deterministic operational answer — the engine answers, NO model call.
   *  Returns a StrategistResponse or null when the question isn't operational. */
  const deterministicAnswer = async (text: string): Promise<StrategistResponse | null> => {
    const intent = detectOperationalIntent(text);
    if (!intent || !brief) return null;
    const staleCloses = await getStaleCloses().catch(() => []);
    const ctx: OperationalAnswerCtx = {
      brief,
      exceptions: exceptions.map((e) => ({ title: e.title, detail: e.detail, resolutionAction: e.resolutionAction, type: e.type, screenLink: e.screenLink })),
      close: null,
      activationReadiness: report.activation.readiness,
      activationNext: report.activation.nextStep ? { title: report.activation.nextStep.title, action: report.activation.nextStep.action, screenLink: report.activation.nextStep.screenLink } : null,
      cashDifferenceCandidates: [],
      stockVariances: [],
      overdueActions: actions.filter((a) => ["accepted", "in_progress"].includes(a.status) && a.dueDate && a.dueDate < todayCairo()).map((a) => ({ title: a.title, screenLink: "/health" })),
      staleCloses,
    };
    const ans = answerOperationalQuestion(intent, ctx);
    return {
      mode: "question", headline: ans.headline, conclusion: ans.headline,
      priorities: ans.points.length ? [{
        rank: 1, type: "action", title: ans.headline, explanation: ans.points.join("\n"),
        evidence: [], recommendedAction: ans.points[0] ?? "", expectedImpact: "",
        urgency: "this_week", confidence: "high", missingData: [],
      }] : [],
      contradictions: [], dataLimitations: [], suggestedQuestions: [], model: "deterministic-engine",
    };
  };

  const suggestions = useMemo(() => suggestQuestions(s, findings), [s, findings]);
  const negFeedbackQ = useQuery({ queryKey: ["strategist-feedback-recent"], queryFn: () => listRecentFeedback(6), enabled: en });
  const convsQ = useQuery({ queryKey: ["strategist-convs"], queryFn: () => listConversations(6), enabled: en });
  const msgsQ = useQuery({ queryKey: ["strategist-msgs", convId], queryFn: () => getMessages(convId!), enabled: en && !!convId });

  const ask = async (text: string, mode: LanguageMode = "question") => {
    if (!text.trim() || pending) return;
    setPending(text); setInput("");
    try {
      let cid = convId;
      if (!cid) { cid = await createConversation(mode, text.slice(0, 100)); setConvId(cid); qc.invalidateQueries({ queryKey: ["strategist-convs"] }); }
      const meta = { generatedAt: new Date().toISOString(), period: s.meta.period.label, lastDataDate: s.meta.lastDataDate };
      await addMessage(cid, "user", { text }, meta);
      qc.invalidateQueries({ queryKey: ["strategist-msgs", cid] });

      // owner memory (decisions, rejections, corrections) — behavioral context only
      const memory = buildOwnerMemory({
        completedActions: actions.filter((a) => a.status === "completed").map((a) => ({ title: a.title, completionNote: a.completionNote, completedAt: a.completedAt })),
        rejectedFeedback: negFeedbackQ.data ?? [],
        dismissedInsights: insights.filter((i) => i.status === "dismissed").map((i) => ({ title: i.title, ownerNote: i.ownerNote })),
      });
      const priorTurns = (msgsQ.data ?? []).slice(-4).map((m) => ({
        role: m.role,
        content: m.role === "user" ? ((m.content as { text?: string }).text ?? "") : ((m.content as StrategistResponse).conclusion ?? ""),
      })).filter((m) => m.content);

      // NEW DIRECTION: the deterministic engine answers operational questions
      // itself — no external model is consulted. The LLM is polish-only, for
      // open-ended questions the engine has no canonical answer for.
      const det = await deterministicAnswer(text);
      if (det) {
        await addMessage(cid, "assistant", det, { ...meta, provider: "deterministic-engine" } as never);
        qc.invalidateQueries({ queryKey: ["strategist-msgs", cid] });
        return;
      }

      const result = await generateLanguage(
        { mode, snapshot: s, report, findings, calendar: computeCalendar(todayCairo()), question: text, history: priorTurns, memory },
        { enhanced: true },
      );
      if (result.fallback) timings.fallbacks += 1;
      timings.lastLanguageMs = result.latencyMs;
      await addMessage(cid, "assistant", result.response, { ...meta, provider: result.provider, fallbackReason: result.fallbackReason } as never);
      qc.invalidateQueries({ queryKey: ["strategist-msgs", cid] });
    } catch (e) {
      reportError("Ask the strategist", e); // only auth errors reach here
    } finally {
      setPending(null);
    }
  };

  const messages = msgsQ.data ?? [];

  // ── decision calculators — pure engine, live as you type ─────────────
  const amt = Number(amount) || 0;
  const wa = useMemo(() => (decision === "withdrawal" && amt > 0 ? assessWithdrawalV2(s, report.cash, amt) : null), [s, report, decision, amt]);
  const aff = useMemo(() => {
    if (decision === "stock" && amt > 0) return assessAffordability(s, report.cash, { kind: "purchase", upfront: amt, mandatory: false, label: "stock purchase" });
    if (decision === "employee" && amt > 0) return assessAffordability(s, report.cash, { kind: "employee", upfront: 0, recurringMonthly: amt, mandatory: false, label: "new employee" });
    return null;
  }, [s, report, decision, amt]);

  const pickDecision = (k: DecisionKind) => {
    setDecision((cur) => (cur === k ? null : k));
    setAiAnswer(null); setShowAll(false); setAmount("");
  };

  const askJudgment = async () => {
    if (!decision || amt <= 0) return;
    const text = decision === "withdrawal" ? `Withdraw ${egp(amt)} this month.`
      : decision === "stock" ? `Buy ${egp(amt)} of stock now.`
      : `Hire an employee at ${egp(amt)} per month.`;
    setAiState("loading");
    try {
      const result = await generateLanguage(
        { mode: "decision_support", snapshot: s, report, findings, calendar: computeCalendar(todayCairo()), decision: text, decisionContext: report.decisionContext },
        { enhanced: true },
      );
      if (result.fallback) timings.fallbacks += 1;
      setAiAnswer({ r: result.response, note: result.fallbackReason ? `Language service unavailable — BostaOS templates answered. (${result.fallbackReason})` : undefined });
    } catch (e) {
      reportError("Decision support", e);
    } finally {
      setAiState("idle");
    }
  };

  return (
    <DeckTile>
      <div className="th"><span className="tname">Ask the strategist</span>
        {convsQ.data && convsQ.data.length > 0 && !decision && (
          <select style={{ marginLeft: "auto", fontSize: 12, background: "var(--surface2)", color: "rgb(var(--muted))", border: "1px solid var(--stroke2)", borderRadius: 8, padding: "4px 8px" }}
            value={convId ?? ""} onChange={(e) => setConvId(e.target.value || null)}>
            <option value="">New conversation</option>
            {convsQ.data.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </div>

      {/* decision chips, then suggested questions — all one row */}
      <div className="aq-chips">
        {(Object.keys(DECISION_META) as DecisionKind[]).map((k) => (
          <button key={k} type="button" className={cn("aq-dchip", decision === k && "on")} onClick={() => pickDecision(k)}>
            {DECISION_META[k].chip}
          </button>
        ))}
        {!decision && suggestions.map((q) => (
          <button key={q.text} className="mbtn" disabled={!!pending} onClick={() => void ask(q.text, q.mode)}>{q.text}</button>
        ))}
      </div>

      {/* thread — hidden while a decision is being worked */}
      {!decision && (
        <div className="space-y-3" style={{ marginTop: 12 }}>
          {messages.map((m) => m.role === "user" ? (
            <div key={m.id} style={{ fontSize: 13, fontWeight: 700, color: "rgb(var(--text))" }}>
              {(m.content as { text?: string }).text}
            </div>
          ) : (
            <AnswerCard key={m.id} r={m.content as StrategistResponse} messageId={m.id} snapshotMeta={m.snapshotMeta} />
          ))}
          {pending && <div style={{ fontSize: 12.5, color: "rgb(var(--dim))" }}>Working on “{pending}”…</div>}
        </div>
      )}

      {/* live verdict for the active decision */}
      {decision === "withdrawal" && wa && (
        <div className="aq-verdict" style={{ "--aqv": VERDICT_META[wa.verdict][1] } as React.CSSProperties}>
          <div className="aq-vhead">
            <Chip text={VERDICT_META[wa.verdict][0]} color={VERDICT_META[wa.verdict][1]} />
            <Chip text={CONF_LABEL[wa.confidence]} color="rgb(var(--dim))" />
            {wa.recommendedMax != null && (
              <span className="aq-vmax"><b className="tnum">{egp(wa.recommendedMax)}</b><span>max safe draw</span></span>
            )}
          </div>
          <div className="aq-facts">
            <KV k="Verified cash" v={wa.verifiedCash} />
            <KV k="After this draw" v={wa.resultingReserve} />
            <KV k="Reserve" v={wa.reserve} />
            {showAll && (<>
              <KV k="Expected (not available)" v={wa.expectedMoney} />
              <KV k="Committed" v={wa.committed} />
              <KV k="Verified headroom" v={wa.verifiedHeadroom} />
              <KV k="Profit context" v={wa.profitContext} />
              <KV k="Already withdrawn" v={wa.withdrawalsAlready} />
              <KV k="Data freshness" v={wa.dataFreshness} />
            </>)}
          </div>
          {wa.reasonsToWait.length > 0 && (
            <div className="aq-reasons">{wa.reasonsToWait.map((r, i) => <div key={i}>· {r}</div>)}</div>
          )}
          <div className="aq-foot">
            <button type="button" className="aq-more" onClick={() => setShowAll((v) => !v)}>{showAll ? "Fewer numbers" : "All numbers"}</button>
            <span className="note" style={{ marginLeft: "auto" }}>Profit ≠ cash in the drawer · Next: {wa.nextStep}</span>
          </div>
        </div>
      )}
      {(decision === "stock" || decision === "employee") && aff && (
        <div className="aq-verdict" style={{ "--aqv": VERDICT_META[aff.verdict]?.[1] ?? "rgb(var(--dim))" } as React.CSSProperties}>
          <div className="aq-vhead">
            <Chip text={VERDICT_META[aff.verdict]?.[0] ?? aff.verdict} color={VERDICT_META[aff.verdict]?.[1] ?? "rgb(var(--dim))"} />
            <Chip text={`${aff.answerLevel} answer`} color="rgb(var(--dim))" />
            {aff.recommendedMax != null && (
              <span className="aq-vmax"><b className="tnum">{egp(aff.recommendedMax)}</b><span>headroom</span></span>
            )}
          </div>
          <div className="aq-facts">
            <KV k="Verified cash" v={aff.verifiedCash != null ? egp(aff.verifiedCash) : "unknown — no fresh count"} />
            <KV k="Committed (30d)" v={egp(aff.committed30)} />
            <KV k="Reserve" v={egp(aff.requiredReserve)} />
            {aff.recurring && <KV k="Monthly burden" v={`${egp(aff.recurring.monthly)}/month${aff.recurring.revenueToCover != null ? ` · needs ~${egp(aff.recurring.revenueToCover)}/month extra sales` : ""}`} />}
            {showAll && (<>
              <KV k="Expected (not available)" v={aff.expectedUnavailable != null ? `~${egp(aff.expectedUnavailable)}` : "—"} />
              {aff.recurring && <KV k="Margin basis" v={aff.recurring.marginBasis} />}
              {aff.recurring?.monthsCoverableFromHeadroom != null && <KV k="Headroom covers" v={`~${aff.recurring.monthsCoverableFromHeadroom} months of this cost with zero benefit`} />}
            </>)}
          </div>
          {aff.reasons.length > 0 && <div className="aq-reasons">{aff.reasons.map((r, i) => <div key={i}>· {r}</div>)}</div>}
          {aff.assumptions.length > 0 && <div className="aq-reasons" style={{ color: "var(--amber)" }}>{aff.assumptions.join(" · ")}</div>}
          <div className="aq-foot">
            <button type="button" className="aq-more" onClick={() => setShowAll((v) => !v)}>{showAll ? "Fewer numbers" : "All numbers"}</button>
            <span className="note" style={{ marginLeft: "auto" }}>Next: {aff.nextStep}</span>
          </div>
        </div>
      )}
      {decision && aiAnswer && (
        <div style={{ marginTop: 12 }}>
          {aiAnswer.note && <div style={{ fontSize: 12, color: "var(--amber)", fontWeight: 600, marginBottom: 8 }}>{aiAnswer.note}</div>}
          <AnswerCard r={aiAnswer.r} messageId={crypto.randomUUID()} snapshotMeta={{ period: s.meta.period.label, lastDataDate: s.meta.lastDataDate }} />
        </div>
      )}

      {/* ONE composer — free question, or the active decision's amount */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {decision ? (
          <>
            <div className="aq-amt">
              <span>EGP</span>
              <Input type="number" inputMode="decimal" autoFocus placeholder={DECISION_META[decision].ask}
                value={amount} onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void askJudgment(); }} />
            </div>
            <Button onClick={() => void askJudgment()} disabled={aiState === "loading" || amt <= 0}>
              {aiState === "loading" ? "Assessing…" : "Judgment"}
            </Button>
          </>
        ) : (
          <>
            <Input placeholder="Ask about your numbers, products, cash, cheques…" value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void ask(input); }} />
            <Button onClick={() => void ask(input)} disabled={!!pending}>{pending ? "…" : "Ask"}</Button>
          </>
        )}
      </div>
    </DeckTile>
  );
}

/* structured answer card — renders the VALIDATED schema, never raw markdown */
function AnswerCard({ r, messageId, snapshotMeta }: { r: StrategistResponse; messageId: string; snapshotMeta: { period?: string; lastDataDate?: string | null; provider?: string; fallbackReason?: string } | null }) {
  const { reportSuccess, reportError } = useUI();
  const [fb, setFb] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);

  const give = async (verdict: "useful" | "not_useful" | "incorrect" | "already_knew" | "acted_on", why?: string) => {
    try {
      await recordFeedback("message", messageId, verdict, why ?? null, snapshotMeta ?? null);
      setFb(verdict); setAskReason(false);
      reportSuccess("Feedback", "Recorded");
    } catch (e) { reportError("Feedback", e); }
  };

  return (
    <div style={{ border: "1px solid var(--stroke)", borderRadius: 12, padding: "12px 14px", background: "var(--surface2)" }}>
      {snapshotMeta?.fallbackReason && (
        <div style={{ fontSize: 11.5, color: "var(--amber)", fontWeight: 600, marginBottom: 6 }}>Template answer — AI offline.</div>
      )}
      <div className="disp" style={{ fontSize: 14.5, fontWeight: 700 }}>{r.headline}</div>
      <p style={{ fontSize: 12.5, color: "rgb(var(--muted))", marginTop: 6, lineHeight: 1.55 }}>{r.conclusion}</p>

      {r.priorities.map((p) => <PriorityBlock key={p.rank} p={p} />)}

      {r.contradictions.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--red)" }}><b>Contradictions:</b> {r.contradictions.join(" · ")}</div>
      )}
      {r.dataLimitations.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 12, color: "rgb(var(--dim))" }}><b>Limits:</b> {r.dataLimitations.join(" · ")}</div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
        {fb ? (
          <span style={{ fontSize: 11.5, color: "rgb(var(--faint))" }}>✓ Noted</span>
        ) : (
          <>
            <button className="mbtn" onClick={() => void give("useful")}>Useful</button>
            <button className="mbtn" onClick={() => void give("not_useful")}>Not useful</button>
            <button className="mbtn" onClick={() => setAskReason(true)}>Incorrect…</button>
            <button className="mbtn" onClick={() => void give("already_knew")}>Knew it</button>
            <button className="mbtn" onClick={() => void give("acted_on")}>Acted on it</button>
          </>
        )}
      </div>
      {askReason && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Input placeholder="What's wrong? (optional — helps future answers)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button onClick={() => void give("incorrect", reason || undefined)}>Send</Button>
        </div>
      )}
    </div>
  );
}

function PriorityBlock({ p }: { p: ResponsePriority }) {
  const [open, setOpen] = useState(p.rank === 1);
  const color = p.type === "risk" || p.type === "contradiction" ? "var(--amber)" : p.type === "opportunity" ? "var(--green)" : p.type === "data" ? "rgb(var(--violet))" : "var(--mag)";
  return (
    <div style={{ marginTop: 10, borderLeft: `2px solid ${color}`, paddingLeft: 10 }}>
      <button onClick={() => setOpen((v) => !v)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", width: "100%" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "rgb(var(--text))" }}>{p.rank}. {p.title}</span>
        <span style={{ fontSize: 11, color: "rgb(var(--faint))" }}> · {URGENCY_LABEL[p.urgency]} · {CONF_LABEL[p.confidence]}</span>
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12.5, color: "rgb(var(--muted))", lineHeight: 1.5 }}>{p.explanation}</div>
          {p.evidence.map((e, i) => (
            <div key={i} style={{ fontSize: 11.5, color: "rgb(var(--dim))", marginTop: 4 }}>
              {e.label}: <b style={{ color: "rgb(var(--muted))" }}>{e.value}</b> · {ownerSource(e.source)} · {e.period} · <Link to={e.screenLink} style={{ color: "var(--mag)" }}>inspect</Link>
            </div>
          ))}
          <div style={{ fontSize: 12.5, color: "rgb(var(--text))", fontWeight: 600, marginTop: 6 }}>→ {p.recommendedAction}</div>
          <div style={{ fontSize: 11.5, color: "rgb(var(--dim))", marginTop: 2 }}>Expected: {p.expectedImpact}</div>
          {p.missingData.length > 0 && <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 2 }}>Missing: {p.missingData.join(" · ")}</div>}
        </div>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "rgb(var(--faint))" }}>{k}</div>
      <div style={{ fontSize: 12.5, color: "rgb(var(--text))", marginTop: 3, lineHeight: 1.45 }}>{v}</div>
    </div>
  );
}

/* ═══ ACTIVATION ══════════════════════════════════════════════════════ */

const READINESS_META: Record<string, [string, string]> = {
  historical_only: ["Historical only", "rgb(var(--violet))"],
  activation_incomplete: ["Activation incomplete", "var(--amber)"],
  live_partial: ["Live · partially verified", "var(--amber)"],
  live_operational: ["Live & operational", "var(--green)"],
  live_verified: ["Live & verified", "var(--green)"],
};

function ActivationTile({ checklist, liveHealth, onConfirmStart }: {
  checklist: ActivationChecklist;
  liveHealth: StrategyReport["liveHealth"];
  onConfirmStart: (date: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(checklist.readiness !== "live_verified" && checklist.readiness !== "live_operational");
  const [startDate, setStartDate] = useState(todayCairo());
  // once fully operational, this collapses to a thin confirmation line
  if (checklist.readiness === "live_verified") {
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", border: "1px solid rgb(var(--good))", background: "rgba(66,226,154,.06)", borderRadius: 12, fontSize: 12.5 }}>
        <Chip text={READINESS_META[checklist.readiness][0]} color={READINESS_META[checklist.readiness][1]} />
        <span style={{ color: "rgb(var(--muted))" }}>{checklist.readinessReason}</span>
      </div>
    );
  }
  const [meta1, meta2] = READINESS_META[checklist.readiness];
  return (
    <DeckTile style={{ borderColor: meta2 }}>
      <div className="th"><span className="tname">Activate BostaOS</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <Chip text={meta1} color={meta2} />
          <button className="mbtn" onClick={() => setOpen((v) => !v)}>{open ? "Collapse" : "Steps"}</button>
        </span>
      </div>
      <div style={{ fontSize: 13, color: "rgb(var(--muted))", marginTop: 8, lineHeight: 1.5 }}>{checklist.readinessReason}</div>
      {checklist.nextStep && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "rgb(var(--faint))" }}>Do this next · {checklist.nextStep.effort} effort</div>
          <div className="disp" style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>{checklist.nextStep.title}</div>
          <div style={{ fontSize: 12.5, color: "rgb(var(--muted))", marginTop: 3 }}>{checklist.nextStep.why}</div>
          <div style={{ fontSize: 11.5, color: "rgb(var(--cyan))", marginTop: 4 }}>Unlocks: {checklist.nextStep.unlocks.join(", ")}</div>
          {checklist.nextStep.key === "live_start" ? (
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ maxWidth: 170 }} />
              <Button onClick={() => void onConfirmStart(startDate)}>Confirm start date</Button>
            </div>
          ) : (
            <Link to={checklist.nextStep.screenLink} style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "var(--mag)", fontWeight: 700 }}>Go to {checklist.nextStep.title.toLowerCase()} →</Link>
          )}
        </div>
      )}
      {open && (
        <div className="space-y-2" style={{ marginTop: 12 }}>
          {checklist.steps.map((step) => (
            <div key={step.key} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5 }}>
              <span style={{ width: 16, color: step.status === "done" ? "var(--green)" : "rgb(var(--faint))" }}>{step.status === "done" ? "✓" : "○"}</span>
              <span style={{ flex: 1, color: step.status === "done" ? "rgb(var(--dim))" : "rgb(var(--text))", textDecoration: step.status === "done" ? "line-through" : "none" }}>{step.title}{!step.required && <span style={{ color: "rgb(var(--faint))" }}> · optional</span>}</span>
              {step.status !== "done" && <Link to={step.screenLink} style={{ fontSize: 11.5, color: "var(--mag)" }}>open</Link>}
            </div>
          ))}
          <div style={{ fontSize: 11, color: "rgb(var(--faint))", marginTop: 8 }}>
            Live completeness {liveHealth.liveCompleteness}% · cash confidence {liveHealth.cashConfidence} · inventory {liveHealth.inventoryConfidence}. Historical gaps don't count against you.
          </div>
        </div>
      )}
    </DeckTile>
  );
}

/* ═══ DAILY CLOSE ═════════════════════════════════════════════════════ */

const KIND_GLYPH: Record<CloseEvaluation["items"][number]["kind"], string> = { auto: "✓", confirm: "◻", blocked: "⛔", unresolved: "⚠", optional: "·" };
const KIND_COLOR: Record<CloseEvaluation["items"][number]["kind"], string> = { auto: "var(--green)", confirm: "rgb(var(--muted))", blocked: "var(--red)", unresolved: "var(--amber)", optional: "rgb(var(--dim))" };

/** Auto-detecting daily close (Cycle 9): BostaOS derives the checklist from
 *  records; the owner attests only to what it can't read. */
function DailyCloseTile({ lastDataDate, signals, onSaved, onError }: { lastDataDate: string | null; signals: CloseSignals; onSaved: () => void; onError: (e: unknown) => void }) {
  const closesQ = useQuery({ queryKey: ["daily-closes"], queryFn: () => getRecentCloses(7), enabled: en });
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(lastDataDate ?? todayCairo());
  const [conf, setConf] = useState({ expensesNone: false, purchasesNone: false, cashSkip: "" });

  const factsQ = useQuery({
    queryKey: ["close-facts", date, signals],
    enabled: en && open,
    queryFn: () => assembleCloseFacts(date, signals),
  });
  const evalr = useMemo(() => factsQ.data ? detectCloseState(factsQ.data, {
    expensesNone: conf.expensesNone, purchasesNone: conf.purchasesNone,
    cashSkip: conf.cashSkip.trim() ? { reason: conf.cashSkip.trim() } : null,
  }) : null, [factsQ.data, conf]);

  const saveComplete = async () => {
    if (!evalr) return;
    try {
      const src = await closeSourceDataAt(date);
      await saveClose({
        locationId: null, date, status: evalr.recommendedStatus,
        completeness: evalr.completeness, confidence: evalr.confidence,
        autoDetected: evalr.items, confirmations: { ...conf },
        unresolved: [...evalr.blocked, ...evalr.unresolved].map((i) => i.label),
        nextAction: evalr.nextAction, sourceDataAt: src,
      });
      onSaved(); setOpen(false); qc.invalidateQueries({ queryKey: ["daily-closes"] }); qc.invalidateQueries({ queryKey: ["strategist-ops"] });
    } catch (e) { onError(e); }
  };
  const saveNoTrading = async () => {
    try { await confirmNoTradingDay(null, date); onSaved(); setOpen(false); qc.invalidateQueries({ queryKey: ["daily-closes"] }); }
    catch (e) { onError(e); }
  };
  const reopen = async (d: string) => {
    const reason = window.prompt("Reason for reopening this close?")?.trim();
    if (!reason) return;
    try { await reopenDailyClose(null, d, reason); qc.invalidateQueries({ queryKey: ["daily-closes"] }); }
    catch (e) { onError(e); }
  };
  const recent = closesQ.data ?? [];

  return (
    <DeckTile>
      <div className="th"><span className="tname">Daily close</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {recent[0] && <Chip text={`last ${fmtDate(recent[0].date)} · ${recent[0].status}${recent[0].isStale ? " · stale" : ""}`} color={recent[0].isStale ? "var(--amber)" : "rgb(var(--dim))"} />}
          <button className="mbtn" onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Run close"}</button>
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 160 }} />
            <span style={{ fontSize: 12, color: "rgb(var(--faint))" }}>BostaOS auto-detects what it can read.</span>
          </div>
          {factsQ.isLoading && <div style={{ fontSize: 12, color: "rgb(var(--dim))", marginTop: 10 }}>Detecting…</div>}
          {evalr && (
            <>
              <div className="space-y-1" style={{ marginTop: 10 }}>
                {evalr.items.map((it) => (
                  <div key={it.key} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5 }}>
                    <span style={{ color: KIND_COLOR[it.kind], fontWeight: 800, width: 14 }}>{KIND_GLYPH[it.kind]}</span>
                    <span style={{ color: it.ok ? "rgb(var(--muted))" : KIND_COLOR[it.kind] }}>{it.label}
                      <span style={{ color: "rgb(var(--faint))" }}> — {it.detail}</span></span>
                  </div>
                ))}
              </div>
              {/* owner attestations for what can't be derived */}
              <div className="space-y-1" style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--stroke2)" }}>
                {evalr.confirmRequired.some((c) => c.key === "expenses") && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "rgb(var(--muted))" }}>
                    <input type="checkbox" checked={conf.expensesNone} onChange={(e) => setConf({ ...conf, expensesNone: e.target.checked })} /> Confirm: no expenses occurred today</label>
                )}
                {evalr.confirmRequired.some((c) => c.key === "purchases") && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "rgb(var(--muted))" }}>
                    <input type="checkbox" checked={conf.purchasesNone} onChange={(e) => setConf({ ...conf, purchasesNone: e.target.checked })} /> Confirm: no purchase was made today</label>
                )}
                {evalr.confirmRequired.some((c) => c.key === "cash_count") && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12.5, color: "rgb(var(--muted))" }}>Skip cash count — reason:</span>
                    <Input value={conf.cashSkip} onChange={(e) => setConf({ ...conf, cashSkip: e.target.value })} placeholder="e.g. drawer untouched" style={{ maxWidth: 220 }} />
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: evalr.canComplete ? "rgb(var(--dim))" : "var(--amber)", marginTop: 8 }}>
                {evalr.canComplete ? `Ready — will save as ${evalr.recommendedStatus} · ${evalr.completeness}% · confidence ${evalr.confidence}` : evalr.blockReason}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Button onClick={() => void saveComplete()}>{evalr.canComplete ? "Complete close" : "Save partial"}</Button>
                <button className="mbtn" onClick={() => void saveNoTrading()}>No trading today</button>
              </div>
            </>
          )}
        </div>
      )}
      {!open && recent.length > 0 && (
        <div style={{ fontSize: 12, color: "rgb(var(--dim))", marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {recent.slice(0, 5).map((c) => (
            <span key={c.date}>
              {fmtDate(c.date)} {c.status === "complete" ? "✓" : c.status === "no_trading" ? "—" : "·"}
              {c.isStale && <button className="mbtn" style={{ marginLeft: 4, color: "var(--amber)" }} onClick={() => void reopen(c.date)}>reopen</button>}
            </span>
          ))}
        </div>
      )}
    </DeckTile>
  );
}

/* ═══ CASH INTELLIGENCE ═══════════════════════════════════════════════ */

function CashIntelligence({ report }: { report: StrategyReport }) {
  const [open, setOpen] = useState(false);
  const cash = report.cash;
  const proj = report.cashProjection;
  const run = report.runway;
  const VERDICT: Record<string, [string, string]> = {
    comfortable: ["Comfortable", "var(--green)"], adequate: ["Adequate", "var(--green)"],
    tight: ["Tight", "var(--amber)"], at_risk: ["At risk", "var(--red)"], unknowable: ["Unverified", "rgb(var(--violet))"],
  };
  const base = proj.scenarios.find((x) => x.name === "base");
  return (
    <DeckTile>
      <div className="th"><span className="tname">Cash intelligence</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <Chip text={VERDICT[cash.safety.verdict][0]} color={VERDICT[cash.safety.verdict][1]} />
          <button className="mbtn" onClick={() => setOpen((v) => !v)}>{open ? "Collapse" : "Detail"}</button>
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 10 }}>
        <KV k="Available now (verified)" v={cash.available.totalVerified != null ? egp(cash.available.totalVerified) : cash.available.note} />
        <KV k="Expected · not available" v={cash.expected.openSettlementNet != null ? `~${egp(cash.expected.openSettlementNet)} settlement pipe${cash.expected.nextChequeEta ? ` · ETA ~${cash.expected.nextChequeEta}` : ""}` : "no measurable pipe"} />
        <KV k="Committed · next 30 days" v={`${egp(cash.committed.next30)}${cash.committed.items[0] ? ` (${cash.committed.items.slice(0, 2).map((o) => o.name).join(", ")}…)` : ""}`} />
        <KV k="Reserve" v={`${egp(cash.safety.requiredReserve)} — ${cash.safety.reserveBasis}`} />
        <KV k="Safe headroom" v={cash.safety.verifiedHeadroom != null ? egp(Math.max(0, cash.safety.verifiedHeadroom)) : `unknowable — ${cash.safety.blockers[0] ?? "data missing"}`} />
        {run.available && <KV k="Coverage" v={run.verifiedCoverageMonths != null ? `verified cash covers ~${run.verifiedCoverageMonths} months of costs` : run.expectedCoverageMonths != null ? `expected position covers ~${run.expectedCoverageMonths} months (unverified)` : "—"} />}
      </div>
      {open && (
        <div style={{ marginTop: 12, fontSize: 12, color: "rgb(var(--muted))", lineHeight: 1.6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "rgb(var(--faint))" }}>30-day outlook ({proj.mode} mode)</div>
          <div>{proj.modeNote}. Largest inflow: {proj.largestInflow}. Largest outflow: {proj.largestOutflow}.</div>
          {base && <div>Base scenario minimum: {proj.mode === "absolute" ? egp(base.minValue) : `${egp(base.minValue)} net movement`} on day {base.minDay}{base.reserveBreachDay != null ? ` · reserve breached around day ${base.reserveBreachDay}` : ""}.</div>}
          {proj.seasonalNote && <div style={{ color: "var(--amber)" }}>{proj.seasonalNote}</div>}
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "rgb(var(--faint))" }}>Obligations</div>
          {cash.committed.items.slice(0, 6).map((o) => (
            <div key={o.name}>· {o.name}: {egp(o.amount)} — {o.due.label} ({o.basis.replace("_", " ")}){o.note ? ` · ${o.note}` : ""}</div>
          ))}
          <div style={{ color: "rgb(var(--dim))" }}>{report.obligations.chequeDeductionsNote}</div>
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "rgb(var(--faint))" }}>Owner money</div>
          <div>{cash.owner.withdrawals > 0 ? `${egp(cash.owner.withdrawals)} withdrawn this period — ${cash.owner.vsNetProfit}` : "no withdrawals recorded this period"}</div>
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "rgb(var(--faint))" }}>What the engine can't know yet</div>
          {cash.uncertain.slice(0, 4).map((u, i) => <div key={i} style={{ color: "rgb(var(--dim))" }}>· {u}</div>)}
        </div>
      )}
    </DeckTile>
  );
}

/* ═══ WEEKLY PRIORITY ═════════════════════════════════════════════════ */

function WeeklyPriorityCard({ weekly, onQueue }: { weekly: ReturnType<typeof selectWeeklyPriority>; onQueue: (item: NonNullable<ReturnType<typeof selectWeeklyPriority>["primary"]>) => Promise<void> }) {
  const [showSecondary, setShowSecondary] = useState(false);
  const p = weekly.primary;
  if (!p) return null;
  return (
    <DeckTile>
      <div className="th" style={{ flexWrap: "wrap" }}><span className="tname">This week's priority</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Chip text={`${p.effort} effort`} color="rgb(var(--dim))" />
          <Chip text={CONF_LABEL[p.confidence] ?? p.confidence} color="rgb(var(--dim))" />
        </span>
      </div>
      <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>{p.action}</div>
      <div style={{ fontSize: 12.5, color: "rgb(var(--muted))", marginTop: 5, lineHeight: 1.5 }}>{p.reason}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 11.5, color: "rgb(var(--dim))" }}>
        {p.evidence.map((e, i) => <span key={i}>{e.label}: <b style={{ color: "rgb(var(--muted))" }}>{e.value}</b></span>)}
      </div>
      <div style={{ fontSize: 11.5, color: "rgb(var(--dim))", marginTop: 8 }}>
        Success: {p.successCriteria} · {p.reviewTiming}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link to={p.screenLink} style={{ fontSize: 12, color: "var(--mag)", fontWeight: 700 }}>Open screen</Link>
        {!p.alreadyQueued && <button className="addbtn" style={{ fontSize: 11.5, padding: "3px 10px" }} onClick={() => void onQueue(p)}>+ Queue it</button>}
        {p.alreadyQueued && <Chip text="Already in your queue" color="rgb(var(--cyan))" />}
        {weekly.secondary.length > 0 && (
          <button className="mbtn" onClick={() => setShowSecondary((v) => !v)}>{showSecondary ? "Hide" : `+${weekly.secondary.length} secondary`}</button>
        )}
      </div>
      {showSecondary && weekly.secondary.map((sx) => (
        <div key={sx.findingId} style={{ marginTop: 10, borderTop: "1px solid var(--stroke2)", paddingTop: 8, fontSize: 12.5 }}>
          <b>{sx.action}</b><span style={{ color: "rgb(var(--dim))" }}> — {sx.reason}</span>
        </div>
      ))}
      {weekly.note && <div style={{ fontSize: 11, color: "rgb(var(--faint))", marginTop: 8 }}>{weekly.note}</div>}
    </DeckTile>
  );
}

/* ═══ PRODUCT STRATEGY (progressive disclosure) ═══════════════════════ */

const TAG_LABEL: Record<string, string> = {
  star: "Star", volume_driver: "Volume driver", profit_driver: "Profit driver",
  high_volume_low_margin: "High volume · low margin", low_volume_high_margin: "High margin · low volume",
  weak: "Weak", declining: "Declining", emerging: "Emerging", stock_risk: "Stock risk",
  cost_unknown: "Cost unknown", data_insufficient: "Thin data", dormant: "Dormant",
  review_pricing: "Review pricing", review_purchasing: "Review purchasing", review_shelf_space: "Review shelf",
};

function ProductStrategy({ report }: { report: StrategyReport }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const pf = report.portfolio;
  return (
    <DeckTile>
      <div className="th"><span className="tname">Product strategy</span>
        <span className="eyebrow" style={{ marginLeft: "auto" }}>
          {pf.available ? `${pf.classifications.length} products · ${report.pricingReviews.length} pricing · ${report.purchaseReviews.length} purchase reviews` : "unavailable"}
        </span>
      </div>
      {!pf.available ? (
        <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", marginTop: 8 }}>{pf.reason}</div>
      ) : (
        <>
          <div className="chiprow" style={{ gap: 8, marginTop: 10 }}>
            {report.shelf.filter((x) => x.verdict === "expand_consideration").slice(0, 3).map((x) => <Chip key={x.name} text={`↑ ${x.name}`} color="var(--green)" />)}
            {report.pricingReviews.slice(0, 3).map((x) => <Chip key={x.name} text={`£ ${x.name}`} color="var(--amber)" />)}
            {report.purchaseReviews.slice(0, 3).map((x) => <Chip key={x.name} text={`⇄ ${x.name}`} color="rgb(var(--cyan))" />)}
            <button className="mbtn" style={{ marginLeft: "auto" }} onClick={() => setOpen((v) => !v)}>{open ? "Collapse" : "Full analysis"}</button>
          </div>
          {open && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "rgb(var(--faint))", marginBottom: 8 }}>
                Thresholds: {pf.thresholds.map((t) => `${t.name} ${t.value} (${t.basis})`).join(" · ")}
              </div>
              <div className="space-y-2">
                {pf.classifications.slice(0, 20).map((c) => (
                  <div key={c.name} style={{ border: "1px solid var(--stroke2)", borderRadius: 10, padding: "8px 12px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <button onClick={() => setDetail(detail === c.name ? null : c.name)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 700, color: "rgb(var(--text))" }}>{c.name}</button>
                      {c.tags.slice(0, 3).map((t) => <Chip key={t} text={TAG_LABEL[t] ?? t} color={t === "star" || t === "emerging" ? "var(--green)" : t.startsWith("review") || t === "declining" || t === "stock_risk" ? "var(--amber)" : "rgb(var(--dim))"} />)}
                      <span style={{ marginLeft: "auto", fontSize: 11.5, color: "rgb(var(--dim))" }} className="tnum">{egp(c.revenue)}{c.marginPct != null ? ` · ${c.marginPct}%` : " · margin unknown"}</span>
                    </div>
                    {detail === c.name && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "rgb(var(--muted))", lineHeight: 1.55 }}>
                        <div>{c.reasons.join(" · ")}</div>
                        <div style={{ marginTop: 4, color: "rgb(var(--text))", fontWeight: 600 }}>→ {c.recommendedAction}</div>
                        <div style={{ marginTop: 2, color: "rgb(var(--dim))" }}>Success: {c.resolutionCriteria} · sells {c.frequencyPct}% of days{c.trendPct != null ? ` · trend ${c.trendPct > 0 ? "+" : ""}${c.trendPct}%` : ""} · coverage {c.coveragePct}%</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {report.pricingReviews.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "rgb(var(--faint))" }}>Pricing review queue</div>
                  {report.pricingReviews.map((r) => (
                    <div key={r.name} style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 6, lineHeight: 1.5 }}>
                      <b style={{ color: "rgb(var(--text))" }}>{r.name}</b> — {r.signals[0]}.
                      {r.priceForTargetMargin != null && <> Min price for {r.targetMarginPct}% margin: <b className="tnum">{egp(r.priceForTargetMargin)}</b> (break-even {egp(r.breakEvenPrice ?? 0)}).</>}
                      {r.missing.length > 0 && <span style={{ color: "var(--amber)" }}> Missing: {r.missing.join(", ")}.</span>}
                      <span style={{ color: "rgb(var(--dim))" }}> {r.risk}.</span>
                    </div>
                  ))}
                </div>
              )}
              {report.purchasePlan.available && report.purchasePlan.recommendations.filter((r) => r.verdict !== "maintain").length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "rgb(var(--faint))" }}>Purchase plan (cash-aware)</div>
                  {report.purchasePlan.recommendations.filter((r) => r.verdict !== "maintain").slice(0, 6).map((r) => (
                    <div key={r.name} style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 6, lineHeight: 1.5 }}>
                      <b style={{ color: "rgb(var(--text))" }}>{r.name}</b> — {r.verdict.replace(/_/g, " ")}
                      {r.recommendedQty != null && <> · buy ~{r.recommendedQty}{r.estimatedCost != null ? ` (${egp(r.estimatedCost)})` : ""}</>}
                      {r.daysCover != null && <> · {r.daysCover}d cover</>}
                      <span style={{ color: r.combined === "unsafe" || r.combined === "count_first" ? "var(--amber)" : "rgb(var(--dim))" }}> · {r.affordabilityNote}</span>
                    </div>
                  ))}
                  {report.purchasePlan.assumptions.length > 0 && <div style={{ fontSize: 11, color: "rgb(var(--faint))", marginTop: 6 }}>{report.purchasePlan.assumptions.join(" · ")}</div>}
                </div>
              )}
              {!report.purchasePlan.available && report.purchasePlan.reason && (
                <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 10 }}>Purchase quantities: {report.purchasePlan.reason}.</div>
              )}
              {report.shelf.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 11, color: "rgb(var(--faint))" }}>{report.shelf[0].caveat}.</div>
              )}
            </div>
          )}
        </>
      )}
    </DeckTile>
  );
}

/* ═══ TUNE (owner context) ════════════════════════════════════════════ */

/** "name | date | note" per line ⇄ upcomingEvents. Round-trips cleanly since
 *  '|' never appears in owner-typed event names/notes in practice; if it did,
 *  the extra segments just fold into the note. */
function parseEventLines(text: string): NonNullable<OwnerContextAnswers["upcomingEvents"]> {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name, date, ...rest] = line.split("|").map((s) => s.trim());
    return { name: name ?? "", date: date ?? "", note: rest.join(" | ") };
  });
}
const eventLines = (events: OwnerContextAnswers["upcomingEvents"]) =>
  (events ?? []).map((e) => `${e.name} | ${e.date} | ${e.note}`).join("\n");

function TuneModal({ open, onClose, onSaved, onError }: { open: boolean; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const [form, setForm] = useState<OwnerContextAnswers>({});
  const [lang, setLang] = useState<LanguageSettings>(DEFAULT_LANGUAGE_SETTINGS);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [showDiag, setShowDiag] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [rawEvents, setRawEvents] = useState("");
  useEffect(() => {
    if (!open || loaded) return;
    Promise.all([loadOwnerContext(), loadLanguageSettings(), providerHealth()])
      .then(([a, l, h]) => { setForm(a ?? {}); setRawEvents(eventLines(a?.upcomingEvents)); setLang(l); setHealth(h); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [open, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      // stamp a confirmation date on every field the owner actually set —
      // that's what flips its basis from "estimated default" to "confirmed"
      const today = new Date().toISOString().slice(0, 10);
      const confirmedAt = { ...(form.confirmedAt ?? {}) };
      for (const [k, v] of Object.entries(form)) {
        if (k !== "confirmedAt" && v !== undefined && v !== null && v !== "") confirmedAt[k] = confirmedAt[k] ?? today;
      }
      await saveOwnerContext({ ...form, confirmedAt });
      await saveLanguageSettings(lang);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError,
  });

  const num = (v: string) => (v === "" ? undefined : Number(v));
  return (
    <Modal open={open} onClose={onClose} title="Tune the strategist">
      <div className="space-y-3">
        <p style={{ fontSize: 12, color: "rgb(var(--dim))" }}>Anything left empty uses a documented default — the strategist says so when it relies on one.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <Field label="Monthly revenue target (EGP)"><Input type="number" value={form.monthlyRevenueTarget ?? ""} onChange={(e) => setForm({ ...form, monthlyRevenueTarget: num(e.target.value) })} /></Field>
          <Field label="Monthly profit target (EGP)"><Input type="number" value={form.monthlyProfitTarget ?? ""} onChange={(e) => setForm({ ...form, monthlyProfitTarget: num(e.target.value) })} /></Field>
          <Field label="Cash reserve floor (EGP)"><Input type="number" placeholder="25000" value={form.cashReserveFloor ?? ""} onChange={(e) => setForm({ ...form, cashReserveFloor: num(e.target.value) })} /></Field>
          <Field label="Gross-margin floor (%)"><Input type="number" placeholder="25" value={form.grossMarginFloorPct ?? ""} onChange={(e) => setForm({ ...form, grossMarginFloorPct: num(e.target.value) })} /></Field>
          <Field label="Stockout tolerance (days)"><Input type="number" placeholder="7" value={form.stockoutToleranceDays ?? ""} onChange={(e) => setForm({ ...form, stockoutToleranceDays: num(e.target.value) })} /></Field>
          <Field label="Max stock cover (days)"><Input type="number" placeholder="45" value={form.maxStockCoverDays ?? ""} onChange={(e) => setForm({ ...form, maxStockCoverDays: num(e.target.value) })} /></Field>
          <Field label="Dead-stock threshold (days)"><Input type="number" placeholder="30" value={form.deadStockDays ?? ""} onChange={(e) => setForm({ ...form, deadStockDays: num(e.target.value) })} /></Field>
          <Field label="Outcome review period (days)"><Input type="number" placeholder="14" value={form.reviewPeriodDays ?? ""} onChange={(e) => setForm({ ...form, reviewPeriodDays: num(e.target.value) })} /></Field>
          <Field label="Cheque overdue after (days)"><Input type="number" placeholder="45" value={form.maxChequeAgeDays ?? ""} onChange={(e) => setForm({ ...form, maxChequeAgeDays: num(e.target.value) })} /></Field>
          <Field label="Reserve policy">
            <select value={form.reserveType ?? "higher_of_both"} onChange={(e) => setForm({ ...form, reserveType: e.target.value as OwnerContextAnswers["reserveType"] })}
              style={{ width: "100%", background: "var(--surface2)", color: "rgb(var(--text))", border: "1px solid var(--stroke)", borderRadius: 10, padding: "8px 10px", fontSize: 13 }}>
              <option value="higher_of_both">Higher of floor / 30d costs</option>
              <option value="fixed">Fixed floor only</option>
              <option value="days_of_costs">30 days of costs</option>
            </select>
          </Field>
          <Field label="Cash count fresh for (days)"><Input type="number" placeholder="7" value={form.cashCountFreshnessDays ?? ""} onChange={(e) => setForm({ ...form, cashCountFreshnessDays: num(e.target.value) })} /></Field>
          <Field label="Downside sales assumption (%)"><Input type="number" placeholder="-25" value={form.downsideSalesPct ?? ""} onChange={(e) => setForm({ ...form, downsideSalesPct: num(e.target.value) })} /></Field>
          <Field label="Right now, what matters more?">
            <select value={form.priorityFocus ?? "balanced"} onChange={(e) => setForm({ ...form, priorityFocus: e.target.value as OwnerContextAnswers["priorityFocus"] })}
              style={{ width: "100%", background: "var(--surface2)", color: "rgb(var(--text))", border: "1px solid var(--stroke)", borderRadius: 10, padding: "8px 10px", fontSize: 13 }}>
              <option value="balanced">Balanced</option><option value="growth">Growth</option><option value="cash_preservation">Cash preservation</option>
            </select>
          </Field>
          <Field label="Strategy style">
            <select value={form.aggressiveness ?? "balanced"} onChange={(e) => setForm({ ...form, aggressiveness: e.target.value as OwnerContextAnswers["aggressiveness"] })}
              style={{ width: "100%", background: "var(--surface2)", color: "rgb(var(--text))", border: "1px solid var(--stroke)", borderRadius: 10, padding: "8px 10px", fontSize: 13 }}>
              <option value="conservative">Conservative</option><option value="balanced">Balanced</option><option value="aggressive">Aggressive</option>
            </select>
          </Field>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "rgb(var(--muted))" }}>
          <input type="checkbox" checked={form.challengeOwner ?? true} onChange={(e) => setForm({ ...form, challengeOwner: e.target.checked })} />
          Challenge my decisions when the numbers argue against them
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "rgb(var(--muted))" }}>
          <input type="checkbox" checked={form.allowPriceRecommendations ?? true} onChange={(e) => setForm({ ...form, allowPriceRecommendations: e.target.checked })} />
          Allow price-change recommendations
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "rgb(var(--muted))" }}>
          <input type="checkbox" checked={form.allowExpectedCashForOptional ?? false} onChange={(e) => setForm({ ...form, allowExpectedCashForOptional: e.target.checked })} />
          Let OPTIONAL spending decisions use expected (uncounted) cash — off means verified cash only
        </label>

        <div style={{ borderTop: "1px solid var(--stroke2)", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "rgb(var(--faint))", marginBottom: 8 }}>Products &amp; priorities</div>
          <p style={{ fontSize: 12, color: "rgb(var(--dim))", marginTop: 0, marginBottom: 8 }}>A protected product is never suggested for discontinuation; a product to grow is weighted up in shelf and purchase advice.</p>
          <div className="space-y-2">
            <Field label="Strategic products — never recommend discontinuing (comma-separated)">
              <Input value={(form.strategicProducts ?? []).join(", ")}
                onChange={(e) => setForm({ ...form, strategicProducts: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                placeholder="e.g. Cashews, Premium Pistachios" />
            </Field>
            <Field label="Products to grow — prioritise in advice (comma-separated)">
              <Input value={(form.productsToGrow ?? []).join(", ")}
                onChange={(e) => setForm({ ...form, productsToGrow: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                placeholder="e.g. Roasted Almonds" />
            </Field>
            <Field label="Withdrawal rule — when a personal withdrawal should be flagged">
              <Input value={form.withdrawalRule ?? ""} onChange={(e) => setForm({ ...form, withdrawalRule: e.target.value || undefined })}
                placeholder={CONTEXT_DEFAULTS.withdrawalRule} />
            </Field>
            <Field label="Briefing cadence — how often you want a summary">
              <Input value={form.briefingCadence ?? ""} onChange={(e) => setForm({ ...form, briefingCadence: e.target.value || undefined })}
                placeholder={CONTEXT_DEFAULTS.briefingCadence} />
            </Field>
            <Field label="Known constraints — anything the strategist should respect (comma-separated)">
              <Input value={(form.knownConstraints ?? []).join(", ")}
                onChange={(e) => setForm({ ...form, knownConstraints: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                placeholder="e.g. limited prep capacity, no refrigeration" />
            </Field>
            <Field label="Upcoming events — one per line: name | date | note">
              <textarea value={rawEvents}
                onChange={(e) => { setRawEvents(e.target.value); setForm({ ...form, upcomingEvents: parseEventLines(e.target.value) }); }}
                placeholder={"Eid al-Fitr | 2026-08-15 | gifting season\nRamadan start | 2026-07-20 | evening demand shifts"}
                rows={3}
                style={{ width: "100%", background: "var(--surface2)", color: "rgb(var(--text))", border: "1px solid var(--stroke)", borderRadius: 10, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
            </Field>
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--stroke2)", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "rgb(var(--faint))", marginBottom: 8 }}>Language service</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Field label="Enhanced explanations">
              <select value={lang.provider} onChange={(e) => setLang({ ...lang, provider: e.target.value as LanguageSettings["provider"] })}
                style={{ width: "100%", background: "var(--surface2)", color: "rgb(var(--text))", border: "1px solid var(--stroke)", borderRadius: 10, padding: "8px 10px", fontSize: 13 }}>
                <option value="anthropic">On (external service)</option>
                <option value="deterministic">Off — BostaOS templates only</option>
              </select>
            </Field>
            <Field label="Max enhanced calls / day"><Input type="number" value={lang.maxCallsPerDay} onChange={(e) => setLang({ ...lang, maxCallsPerDay: Number(e.target.value) || 0 })} /></Field>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "rgb(var(--muted))", marginTop: 8 }}>
            <input type="checkbox" checked={lang.allowEnhanced} onChange={(e) => setLang({ ...lang, allowEnhanced: e.target.checked })} />
            Allow enhanced briefings and answers (each call costs money; nothing runs automatically)
          </label>
          <button className="mbtn" style={{ marginTop: 10 }} onClick={() => setShowDiag((v) => !v)}>{showDiag ? "Hide diagnostics" : "Diagnostics"}</button>
          {showDiag && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "rgb(var(--dim))", lineHeight: 1.7 }}>
              {health.map((h) => <div key={h.id}>{h.id}: {h.available ? "available" : "unavailable"} — {h.detail}{h.lastLatencyMs ? ` · ${h.lastLatencyMs}ms` : ""}</div>)}
              <div>snapshot {timings.snapshotMs ?? "—"}ms · engine {timings.engineMs ?? "—"}ms · insight sync {timings.syncMs ?? "—"}ms · last language {timings.lastLanguageMs ?? "—"}ms</div>
              <div>fallbacks this session: {timings.fallbacks} · validation repairs: {timings.validationRepairs}</div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="mbtn" onClick={onClose}>Cancel</button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}
