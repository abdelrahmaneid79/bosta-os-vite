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
import { DeckTile, PageHdr } from "./deck";
import { Button, Field, Input } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { SkeletonRows, ErrorState, EmptyState } from "@/components/feedback";
import { isEngineConfigured } from "@/core/db/engine";
import { egp } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { useUI } from "@/store/ui";
import { todayCairo } from "@/core/time";
import { assembleSnapshotV2 } from "@/core/strategist/snapshot-v2";
import { analyzeSnapshot } from "@/core/strategist/analysis/engine";
import type { Finding } from "@/core/strategist/analysis/types";
import type { StrategistSnapshot } from "@/core/strategist/contract";
import { computeDecisionContext } from "@/core/strategist/analysis/decision";
import { assessWithdrawal } from "@/core/strategist/analysis/withdrawal";
import { computeCalendar } from "@/core/strategist/calendar";
import { suggestQuestions } from "@/core/strategist/questions";
import { askStrategistV2, StrategistAuthError, StrategistUnavailableError, type StrategistMode } from "@/core/strategist/client-v2";
import type { StrategistResponse, ResponsePriority } from "@/core/strategist/response";
import { loadOwnerContext, saveOwnerContext, type OwnerContextAnswers } from "@/core/strategist/context";
import {
  syncInsights, listInsights, setInsightStatus, type InsightRow,
  createAction, listActions, updateActionStatus, type ActionRow,
  createConversation, addMessage, getMessages, listConversations,
  recordFeedback, getCachedBriefing, saveCachedBriefing,
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

export function StrategistScreen() {
  const qc = useQueryClient();
  const { reportError, reportSuccess } = useUI();

  const snapQ = useQuery({ queryKey: ["snapshot-v2"], queryFn: assembleSnapshotV2, enabled: en, staleTime: 5 * 60_000 });
  const s = snapQ.data;
  const findings = useMemo(() => (s ? analyzeSnapshot(s) : []), [s]);

  // persist qualifying findings once per snapshot (evidence-based lifecycle)
  const syncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!s || findings.length === 0) return;
    const key = `${s.meta.period.label}|${s.meta.lastDataDate}`;
    if (syncedFor.current === key) return;
    syncedFor.current = key;
    syncInsights(findings, s.meta.period.label)
      .then(() => qc.invalidateQueries({ queryKey: ["strategist-insights"] }))
      .catch(() => { syncedFor.current = null; });
  }, [s, findings, qc]);

  const insightsQ = useQuery({ queryKey: ["strategist-insights"], queryFn: listInsights, enabled: en });
  const actionsQ = useQuery({ queryKey: ["strategist-actions"], queryFn: listActions, enabled: en });

  const [drawer, setDrawer] = useState<Finding | null>(null);
  const [tuneOpen, setTuneOpen] = useState(false);

  if (!en) return <EmptyState title="Sign in to load the strategist" />;
  if (snapQ.isError) {
    const msg = String((snapQ.error as Error)?.message ?? "");
    return <ErrorState message={`The snapshot could not be assembled — ${msg}. The strategist needs the read-model to work; reload to retry.`} />;
  }
  if (snapQ.isLoading || !s) return <div className="cdk"><SkeletonRows rows={8} /></div>;

  const insights = insightsQ.data ?? [];
  const insightByFinding = new Map(insights.map((i) => [i.findingId, i]));

  return (
    <div className="cdk space-y-5">
      <PageHdr title="Strategist" sub="Deterministic findings from your audited books · AI interpretation on demand"
        right={<button className="addbtn" onClick={() => setTuneOpen(true)}>⚙ Tune</button>} />

      <FreshnessStrip s={s} />
      <ExecutiveBriefing s={s} findings={findings} />
      <WhatMattersNow findings={findings} insightByFinding={insightByFinding} onEvidence={setDrawer}
        onStatus={async (row, status) => { await setInsightStatus(row.id, status); qc.invalidateQueries({ queryKey: ["strategist-insights"] }); }}
        onAccept={async (f) => {
          const a = f.action;
          const res = await createAction({
            title: a?.title ?? f.title, description: a?.action ?? f.detail, source: "finding",
            findingId: f.id, category: f.class, priority: f.urgency === "today" ? "high" : f.urgency === "this_week" ? "medium" : "low",
            screenLink: a?.screenLink ?? "/health", expectedOutcome: a?.expectedImpact ?? null, status: "accepted",
          });
          reportSuccess("Action queue", res.created ? "Added to your action queue" : "Already in your queue");
          qc.invalidateQueries({ queryKey: ["strategist-actions"] });
        }} />
      <ActionQueue actions={actionsQ.data ?? []} onUpdate={async (id, status, note) => {
        await updateActionStatus(id, status, note); qc.invalidateQueries({ queryKey: ["strategist-actions"] });
      }} />
      <AskStrategist s={s} findings={findings} actions={actionsQ.data ?? []} insights={insights} />
      <DecisionMode s={s} findings={findings} />

      <EvidenceDrawer finding={drawer} onClose={() => setDrawer(null)} />
      <TuneModal open={tuneOpen} onClose={() => setTuneOpen(false)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["snapshot-v2"] }); reportSuccess("Strategist", "Settings saved — snapshot refreshed"); }}
        onError={(e) => reportError("Strategist settings", e)} />
    </div>
  );
}

/* ═══ FRESHNESS ═══════════════════════════════════════════════════════ */

function FreshnessStrip({ s }: { s: StrategistSnapshot }) {
  const items: { label: string; value: string; warn?: boolean }[] = [
    { label: "Books to", value: s.meta.lastDataDate ? fmtDate(s.meta.lastDataDate) : "no sales", warn: s.meta.isStale },
    { label: "Period", value: s.meta.period.label },
    { label: "COGS coverage", value: s.products.coveragePct.value != null ? `${Math.round(s.products.coveragePct.value)}% of revenue` : "none", warn: (s.products.coveragePct.value ?? 0) < 60 },
    { label: "Cash data", value: s.cash.hasLiveData ? (s.cash.lastCountDate.value ? `counted ${fmtDate(s.cash.lastCountDate.value)}` : "partial") : "not tracked", warn: !s.cash.hasLiveData },
    { label: "Inventory", value: s.inventory.hasLiveData ? "tracked" : "not tracked", warn: !s.inventory.hasLiveData },
    { label: "Completeness", value: `${s.meta.completenessScore}/100`, warn: s.meta.completenessScore < 60 },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: "10px 14px", border: "1px solid var(--stroke2)", borderRadius: 12, background: "var(--surface2)" }}>
      {items.map((it) => (
        <div key={it.label} style={{ fontSize: 12 }}>
          <span style={{ color: "rgb(var(--faint))", fontWeight: 600 }}>{it.label} </span>
          <span style={{ color: it.warn ? "var(--amber)" : "rgb(var(--muted))", fontWeight: 700 }}>{it.value}</span>
        </div>
      ))}
      {s.meta.isStale && s.meta.staleDays != null && (
        <div style={{ fontSize: 12, color: "var(--amber)", fontWeight: 700 }}>
          ⚠ {s.meta.staleDays} days behind — numbers are as of {s.meta.lastDataDate ? fmtDate(s.meta.lastDataDate) : "—"}, not today
        </div>
      )}
    </div>
  );
}

/* ═══ EXECUTIVE BRIEFING ══════════════════════════════════════════════ */

function ExecutiveBriefing({ s, findings }: { s: StrategistSnapshot; findings: Finding[] }) {
  const { reportError } = useUI();
  const [ai, setAi] = useState<{ response: StrategistResponse; cached: boolean; snapshotLabel: string } | null>(null);
  const [aiState, setAiState] = useState<"idle" | "loading" | "unavailable">("idle");
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
      const response = await askStrategistV2({ mode: "daily_brief", snapshot: s, findings, calendar: computeCalendar(todayCairo()) });
      const meta = { generatedAt: new Date().toISOString(), period: s.meta.period.label, lastDataDate: s.meta.lastDataDate };
      setAi({ response, cached: false, snapshotLabel: `${meta.period} · books to ${meta.lastDataDate ?? "—"}` });
      setAiState("idle");
      await saveCachedBriefing({ response, snapshotMeta: meta, generatedAt: meta.generatedAt });
    } catch (e) {
      setAiState("unavailable");
      if (e instanceof StrategistAuthError) reportError("Strategist", e);
      // Unavailable / timeout / invalid response: stay deterministic, no auto-retry.
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
          {ai ? <Chip text={ai.cached ? "AI · cached" : "AI-enhanced"} color="rgb(var(--cyan))" /> : <Chip text="Deterministic" color="rgb(var(--violet))" />}
          <Button onClick={() => void generate()} disabled={aiState === "loading"}>
            {aiState === "loading" ? "Thinking…" : ai ? "Refresh AI briefing" : "Generate AI briefing"}
          </Button>
        </span>
      </div>

      {aiState === "unavailable" && (
        <div style={{ margin: "10px 0", fontSize: 12.5, color: "var(--amber)", fontWeight: 600 }}>
          The AI is unavailable right now (likely API credits or a timeout). Everything below is the deterministic engine — fully trustworthy, just less narrative. No automatic retries.
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

const MINI: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "rgb(var(--muted))", background: "none", border: "1px solid var(--stroke)", borderRadius: 8, padding: "4px 10px", cursor: "pointer" };

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
            <div key={f.id} style={{ border: "1px solid var(--stroke2)", borderLeft: `3px solid ${meta.color}`, borderRadius: 12, padding: "12px 14px" }}>
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
                  <button style={MINI} onClick={() => void onStatus(row, "acknowledged")}>Acknowledge</button>
                  <button style={MINI} onClick={() => void onStatus(row, "dismissed")}>Dismiss</button>
                  {row.status === "reopened" && <Chip text="Returned after being resolved" color="var(--amber)" />}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {findings.length > 3 && (
        <button style={{ ...MINI, marginTop: 12 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show top 3 only" : `Show all ${findings.length} findings`}
        </button>
      )}
    </DeckTile>
  );
}

/* ═══ EVIDENCE DRAWER ═════════════════════════════════════════════════ */

function EvidenceDrawer({ finding, onClose }: { finding: Finding | null; onClose: () => void }) {
  return (
    <Modal open={!!finding} onClose={onClose} title="Evidence">
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
            {CONF_LABEL[finding.confidence]} · {finding.impactEgp != null ? `${egp(finding.impactEgp)} estimated at stake` : "impact honestly unquantified"}
          </div>
        </div>
      )}
    </Modal>
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
      {open.length === 0 && <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", marginTop: 8 }}>Nothing queued. Accept a finding's action above, or add your own below.</div>}
      <div className="space-y-2" style={{ marginTop: 8 }}>
        {open.map((a) => (
          <div key={a.id} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", border: "1px solid var(--stroke2)", borderRadius: 10, padding: "9px 12px" }}>
            <Chip text={a.priority} color={a.priority === "high" ? "var(--red)" : a.priority === "medium" ? "var(--amber)" : "rgb(var(--dim))"} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{a.title}</div>
              {a.description && <div style={{ fontSize: 11.5, color: "rgb(var(--dim))" }}>{a.description}</div>}
              <div style={{ fontSize: 10.5, color: "rgb(var(--faint))" }}>{a.source === "owner" ? "yours" : `from ${a.source}`} · {fmtDate(a.createdAt.slice(0, 10))}{a.dueDate ? ` · due ${fmtDate(a.dueDate)}` : ""}</div>
            </div>
            <Link to={a.screenLink} style={{ fontSize: 11.5, color: "var(--mag)", fontWeight: 700 }}>Open</Link>
            {a.status !== "in_progress" && <button style={MINI} onClick={() => void onUpdate(a.id, "in_progress")}>Start</button>}
            <button style={MINI} onClick={() => void onUpdate(a.id, "completed")}>Done</button>
            <button style={{ ...MINI, color: "rgb(var(--faint))" }} onClick={() => void onUpdate(a.id, "dismissed")}>Dismiss</button>
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

function AskStrategist({ s, findings, actions, insights }: {
  s: StrategistSnapshot; findings: Finding[]; actions: ActionRow[]; insights: InsightRow[];
}) {
  const { reportError } = useUI();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [convId, setConvId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [aiDown, setAiDown] = useState(false);

  const suggestions = useMemo(() => suggestQuestions(s, findings), [s, findings]);
  const convsQ = useQuery({ queryKey: ["strategist-convs"], queryFn: () => listConversations(6), enabled: en });
  const msgsQ = useQuery({ queryKey: ["strategist-msgs", convId], queryFn: () => getMessages(convId!), enabled: en && !!convId });

  const ask = async (text: string, mode: StrategistMode = "question") => {
    if (!text.trim() || pending) return;
    setPending(text); setAiDown(false); setInput("");
    try {
      let cid = convId;
      if (!cid) { cid = await createConversation(mode, text.slice(0, 100)); setConvId(cid); qc.invalidateQueries({ queryKey: ["strategist-convs"] }); }
      const meta = { generatedAt: new Date().toISOString(), period: s.meta.period.label, lastDataDate: s.meta.lastDataDate };
      await addMessage(cid, "user", { text }, meta);
      qc.invalidateQueries({ queryKey: ["strategist-msgs", cid] });

      // owner memory (decisions, rejections) — behavioral context only, never numbers
      const memory = buildOwnerMemory({
        completedActions: actions.filter((a) => a.status === "completed").map((a) => ({ title: a.title, completionNote: a.completionNote, completedAt: a.completedAt })),
        rejectedFeedback: [],
        dismissedInsights: insights.filter((i) => i.status === "dismissed").map((i) => ({ title: i.title, ownerNote: i.ownerNote })),
      });
      const priorTurns = (msgsQ.data ?? []).slice(-4).map((m) => ({
        role: m.role,
        content: m.role === "user" ? ((m.content as { text?: string }).text ?? "") : ((m.content as StrategistResponse).conclusion ?? ""),
      })).filter((m) => m.content);
      const history = memory.length
        ? [{ role: "user" as const, content: `OWNER MEMORY (behavioral context, never business data): ${memory.join(" | ")}` }, ...priorTurns]
        : priorTurns;

      const response = await askStrategistV2({ mode, snapshot: s, findings, calendar: computeCalendar(todayCairo()), question: text, history });
      await addMessage(cid, "assistant", response, meta);
      qc.invalidateQueries({ queryKey: ["strategist-msgs", cid] });
    } catch (e) {
      if (e instanceof StrategistUnavailableError) setAiDown(true);
      else reportError("Ask the strategist", e);
    } finally {
      setPending(null);
    }
  };

  const messages = msgsQ.data ?? [];

  return (
    <DeckTile>
      <div className="th"><span className="tname">Ask the strategist</span>
        {convsQ.data && convsQ.data.length > 0 && (
          <select style={{ marginLeft: "auto", fontSize: 12, background: "var(--surface2)", color: "rgb(var(--muted))", border: "1px solid var(--stroke2)", borderRadius: 8, padding: "4px 8px" }}
            value={convId ?? ""} onChange={(e) => setConvId(e.target.value || null)}>
            <option value="">New conversation</option>
            {convsQ.data.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </div>

      {/* suggested questions — from live data, never canned */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {suggestions.map((q) => (
          <button key={q.text} style={MINI} disabled={!!pending} onClick={() => void ask(q.text, q.mode)}>{q.text}</button>
        ))}
      </div>

      {aiDown && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--amber)", fontWeight: 600 }}>
          The AI can't answer right now (credits or timeout). Your question wasn't lost — the deterministic findings above still stand. Retry whenever you choose; nothing retries by itself.
        </div>
      )}

      <div className="space-y-3" style={{ marginTop: 12 }}>
        {messages.map((m) => m.role === "user" ? (
          <div key={m.id} style={{ fontSize: 13, fontWeight: 700, color: "rgb(var(--text))" }}>
            {(m.content as { text?: string }).text}
            {m.snapshotMeta?.lastDataDate && <span style={{ fontSize: 10.5, color: "rgb(var(--faint))", fontWeight: 500 }}> · asked on books to {m.snapshotMeta.lastDataDate}</span>}
          </div>
        ) : (
          <AnswerCard key={m.id} r={m.content as StrategistResponse} messageId={m.id} snapshotMeta={m.snapshotMeta} />
        ))}
        {pending && <div style={{ fontSize: 12.5, color: "rgb(var(--dim))" }}>Working on “{pending}”…</div>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Input placeholder="Ask about your numbers, products, cash, cheques…" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void ask(input); }} />
        <Button onClick={() => void ask(input)} disabled={!!pending}>{pending ? "…" : "Ask"}</Button>
      </div>
    </DeckTile>
  );
}

/* structured answer card — renders the VALIDATED schema, never raw markdown */
function AnswerCard({ r, messageId, snapshotMeta }: { r: StrategistResponse; messageId: string; snapshotMeta: { period?: string; lastDataDate?: string | null } | null }) {
  const { reportSuccess, reportError } = useUI();
  const [fb, setFb] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);

  const give = async (verdict: "useful" | "not_useful" | "incorrect" | "already_knew" | "acted_on", why?: string) => {
    try {
      await recordFeedback("message", messageId, verdict, why ?? null, snapshotMeta ?? null);
      setFb(verdict); setAskReason(false);
      reportSuccess("Feedback", "Recorded for the evaluation suite — it never silently rewrites rules");
    } catch (e) { reportError("Feedback", e); }
  };

  return (
    <div style={{ border: "1px solid var(--stroke)", borderRadius: 12, padding: "12px 14px", background: "var(--surface2)" }}>
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
          <span style={{ fontSize: 11.5, color: "rgb(var(--faint))" }}>Feedback: {fb.replace("_", " ")} ✓</span>
        ) : (
          <>
            <button style={MINI} onClick={() => void give("useful")}>Useful</button>
            <button style={MINI} onClick={() => void give("not_useful")}>Not useful</button>
            <button style={MINI} onClick={() => setAskReason(true)}>Incorrect…</button>
            <button style={MINI} onClick={() => void give("already_knew")}>Knew it</button>
            <button style={MINI} onClick={() => void give("acted_on")}>Acted on it</button>
          </>
        )}
        {r.usage?.cache_read_input_tokens ? <span style={{ fontSize: 10.5, color: "rgb(var(--faint))", marginLeft: "auto" }}>cached context reused</span> : null}
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

/* ═══ DECISION MODE ═══════════════════════════════════════════════════ */

type DecisionKind = "withdrawal" | "price" | "stock" | "other";

function DecisionMode({ s, findings }: { s: StrategistSnapshot; findings: Finding[] }) {
  const { reportError } = useUI();
  const [kind, setKind] = useState<DecisionKind>("withdrawal");
  const [amount, setAmount] = useState("20000");
  const [freeText, setFreeText] = useState("");
  const [aiAnswer, setAiAnswer] = useState<StrategistResponse | null>(null);
  const [aiState, setAiState] = useState<"idle" | "loading" | "down">("idle");

  const ctx = useMemo(() => computeDecisionContext(s), [s]);
  const amt = Number(amount) || 0;
  const wa = useMemo(() => (kind === "withdrawal" && amt > 0 ? assessWithdrawal(s, ctx, amt) : null), [s, ctx, kind, amt]);

  const askAI = async () => {
    const decision = kind === "withdrawal" ? `Withdraw ${egp(amt)} this month.` : freeText;
    if (!decision.trim()) return;
    setAiState("loading");
    try {
      const r = await askStrategistV2({ mode: "decision_support", snapshot: s, findings, calendar: computeCalendar(todayCairo()), decision, decisionContext: ctx });
      setAiAnswer(r); setAiState("idle");
    } catch (e) {
      if (e instanceof StrategistUnavailableError) setAiState("down");
      else { setAiState("idle"); reportError("Decision support", e); }
    }
  };

  const VERDICT_META: Record<string, [string, string]> = {
    safe: ["Affordable", "var(--green)"], tight: ["Possible but tight", "var(--amber)"],
    unsafe: ["Not safely affordable", "var(--red)"], unknowable: ["Can't be verified yet", "rgb(var(--violet))"],
  };

  return (
    <DeckTile>
      <div className="th"><span className="tname">Decision mode</span>
        <span className="eyebrow" style={{ marginLeft: "auto" }}>deterministic numbers first · AI judgment second</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {([["withdrawal", "Owner withdrawal"], ["price", "Price change"], ["stock", "Buy stock"], ["other", "Something else"]] as [DecisionKind, string][]).map(([k, label]) => (
          <button key={k} style={{ ...MINI, ...(kind === k ? { borderColor: "var(--mag)", color: "var(--mag)" } : {}) }} onClick={() => { setKind(k); setAiAnswer(null); }}>{label}</button>
        ))}
      </div>

      {kind === "withdrawal" ? (
        <div style={{ marginTop: 12 }}>
          <Field label="How much do you want to take out? (EGP)">
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 200 }} />
          </Field>
          {wa && (
            <div style={{ marginTop: 12, border: "1px solid var(--stroke2)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Chip text={VERDICT_META[wa.verdict][0]} color={VERDICT_META[wa.verdict][1]} />
                <Chip text={CONF_LABEL[wa.confidence]} color="rgb(var(--dim))" />
                {wa.recommendedMax != null && <span style={{ fontSize: 13, fontWeight: 700 }}>Recommended max: {egp(wa.recommendedMax)}</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, marginTop: 12 }}>
                <KV k="Cash position" v={wa.cashPosition} />
                <KV k="Reserve floor" v={wa.reserveFloor} />
                <KV k="Headroom above floor" v={wa.headroom} />
                <KV k="Profit context" v={wa.profitContext} />
                <KV k="Money at the mall" v={wa.settlementContext} />
                <KV k="Data freshness" v={wa.dataFreshness} />
              </div>
              {wa.reasonsToWait.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "rgb(var(--faint))" }}>Reasons to wait</div>
                  {wa.reasonsToWait.map((r, i) => <div key={i} style={{ fontSize: 12.5, color: "rgb(var(--muted))", marginTop: 3 }}>· {r}</div>)}
                </div>
              )}
              <div style={{ fontSize: 11.5, color: "rgb(var(--faint))", marginTop: 10 }}>
                A profitable month does not automatically mean the cash is in the drawer — profit and cash are checked separately above.
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <Field label="Describe the decision you're considering">
            <Input placeholder={kind === "price" ? "e.g. raise كاجو price by 10%" : kind === "stock" ? "e.g. buy 30kg of سوداني before Ramadan" : "I'm considering…"}
              value={freeText} onChange={(e) => setFreeText(e.target.value)} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, marginTop: 12 }}>
            <KV k="Cash headroom" v={ctx.cashHeadroomAboveFloor != null ? egp(ctx.cashHeadroomAboveFloor) : `unknown — ${ctx.cashHeadroomNote}`} />
            <KV k="One margin point is worth" v={ctx.marginPointValue != null ? `${egp(ctx.marginPointValue)} / period` : "unknown"} />
            <KV k="Money due from the mall" v={ctx.openTabEstimatedNet != null ? `~${egp(ctx.openTabEstimatedNet)}` : "unknown"} />
            {ctx.belowMarginFloor.length > 0 && <KV k="Below your margin floor" v={ctx.belowMarginFloor.map((p) => `${p.name} (${p.marginPct}%)`).join(", ")} />}
          </div>
          {ctx.caveats.length > 0 && <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 8 }}>{ctx.caveats.join(" · ")}</div>}
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button onClick={() => void askAI()} disabled={aiState === "loading"}>
          {aiState === "loading" ? "Assessing…" : "Get the strategist's judgment"}
        </Button>
        {aiState === "down" && <span style={{ fontSize: 12, color: "var(--amber)", fontWeight: 600 }}>AI unavailable — the deterministic numbers above still hold.</span>}
      </div>
      {aiAnswer && <div style={{ marginTop: 12 }}><AnswerCard r={aiAnswer} messageId={crypto.randomUUID()} snapshotMeta={{ period: s.meta.period.label, lastDataDate: s.meta.lastDataDate }} /></div>}
    </DeckTile>
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

/* ═══ TUNE (owner context) ════════════════════════════════════════════ */

function TuneModal({ open, onClose, onSaved, onError }: { open: boolean; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const [form, setForm] = useState<OwnerContextAnswers>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open || loaded) return;
    loadOwnerContext().then((a) => { setForm(a ?? {}); setLoaded(true); }).catch(() => setLoaded(true));
  }, [open, loaded]);

  const save = useMutation({
    mutationFn: () => saveOwnerContext(form),
    onSuccess: () => { onSaved(); onClose(); },
    onError,
  });

  const num = (v: string) => (v === "" ? undefined : Number(v));
  return (
    <Modal open={open} onClose={onClose} title="Tune the strategist">
      <div className="space-y-3">
        <p style={{ fontSize: 12, color: "rgb(var(--dim))" }}>Anything left empty uses a documented default — the strategist says so whenever it relies on one.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Monthly revenue target (EGP)"><Input type="number" value={form.monthlyRevenueTarget ?? ""} onChange={(e) => setForm({ ...form, monthlyRevenueTarget: num(e.target.value) })} /></Field>
          <Field label="Monthly profit target (EGP)"><Input type="number" value={form.monthlyProfitTarget ?? ""} onChange={(e) => setForm({ ...form, monthlyProfitTarget: num(e.target.value) })} /></Field>
          <Field label="Cash reserve floor (EGP)"><Input type="number" placeholder="25000" value={form.cashReserveFloor ?? ""} onChange={(e) => setForm({ ...form, cashReserveFloor: num(e.target.value) })} /></Field>
          <Field label="Gross-margin floor (%)"><Input type="number" placeholder="25" value={form.grossMarginFloorPct ?? ""} onChange={(e) => setForm({ ...form, grossMarginFloorPct: num(e.target.value) })} /></Field>
          <Field label="Stockout tolerance (days)"><Input type="number" placeholder="7" value={form.stockoutToleranceDays ?? ""} onChange={(e) => setForm({ ...form, stockoutToleranceDays: num(e.target.value) })} /></Field>
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
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={MINI} onClick={onClose}>Cancel</button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}
