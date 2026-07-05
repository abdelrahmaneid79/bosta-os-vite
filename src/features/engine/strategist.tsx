/** Business Strategist — the rebuilt Insights › Health screen. An interactive AI
 *  strategist that reasons ON TOP of the heuristic engines: it reads the audited
 *  snapshot (grounded, read-only), the owner's objective + context, and the real
 *  calendar, and returns a health read + daily action plan + follow-up chat.
 *  TRENDS and DATA-CONFIDENCE panels are rendered deterministically from the
 *  snapshot (not the model). The ONLY writes are the objective/context text. */
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DeckTile, TileHead } from "./deck";
import { Button, Sparkline } from "@/components/ui";
import { SkeletonRows, ErrorState, EmptyState } from "@/components/feedback";
import { isEngineConfigured } from "@/core/db/engine";
import { todayCairo } from "@/core/time";
import { egp, num } from "@/core/utils/format";
import { useUI } from "@/store/ui";
import { assembleSnapshot } from "@/core/strategist/snapshot";
import { computeCalendar } from "@/core/strategist/calendar";
import { askStrategist, StrategistAuthError, type StrategistMessage } from "@/core/strategist/client";
import { getStrategistConfig, saveObjective, saveContext } from "@/core/strategist/config";

const BRIEF_PROMPT =
  "Give me my current business briefing.\n\n**Business health** — a short read of what's working, what's at risk, and why, grounded strictly in my real figures.\n\n**Today's action plan** — the concrete, prioritized moves for today and this week tied to my objective, my context, the data and the calendar: product-mix shifts, margin actions, inventory/reorder timing by weight, cash timing around the cheque settlement, and any seasonal prep. Be specific and Egypt/category-aware — no filler.";

const QUICK = [
  "What should I focus on today?",
  "Where am I losing margin?",
  "Prep me for the next holiday.",
];

/** Tiny, dependency-free markdown → JSX (headers, bold, bullets, paragraphs). */
function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let list: string[] = [];
  const flush = (i: number) => {
    if (!list.length) return;
    blocks.push(<ul key={`u${i}`} style={{ margin: "6px 0 10px", paddingLeft: 18, display: "grid", gap: 5 }}>{list.map((l, j) => <li key={j} style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--muted)" }}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, k) => (p.startsWith("**") && p.endsWith("**")) ? <b key={k} style={{ color: "var(--text)", fontWeight: 700 }}>{p.slice(2, -2)}</b> : <span key={k}>{p}</span>);
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (/^#{1,3}\s/.test(l)) { flush(i); blocks.push(<div key={i} style={{ fontWeight: 700, color: "var(--text)", fontSize: 14.5, margin: "12px 0 4px", letterSpacing: ".01em" }}>{inline(l.replace(/^#{1,3}\s/, ""))}</div>); }
    else if (/^[-*]\s/.test(l)) { list.push(l.replace(/^[-*]\s/, "")); }
    else if (!l) { flush(i); }
    else { flush(i); blocks.push(<p key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)", margin: "0 0 8px" }}>{inline(l)}</p>); }
  });
  flush(lines.length);
  return <div>{blocks}</div>;
}

export function StrategistScreen() {
  const qc = useQueryClient();
  const { reportError } = useUI();
  const today = todayCairo();
  const calendar = useMemo(() => computeCalendar(today), [today]);

  const cfg = useQuery({ queryKey: ["strategist-config"], queryFn: getStrategistConfig, enabled: isEngineConfigured });
  const snap = useQuery({ queryKey: ["strategist-snapshot"], queryFn: assembleSnapshot, enabled: isEngineConfigured, staleTime: 5 * 60_000 });

  const [objective, setObjective] = useState<string | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const obj = objective ?? cfg.data?.objective ?? "";
  const ctx = context ?? cfg.data?.context ?? "";

  const [messages, setMessages] = useState<StrategistMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: async (userText: string) => {
      if (!snap.data) throw new Error("Snapshot not ready yet.");
      // persist the owner text (the only writes) so it's there next session
      await Promise.all([saveObjective(obj), saveContext(ctx)]);
      const next = [...messages, { role: "user" as const, content: userText }];
      setMessages(next);
      const reply = await askStrategist({ objective: obj, context: ctx, snapshot: snap.data, calendar, messages: next });
      return reply;
    },
    onSuccess: (reply) => { setMessages((m) => [...m, { role: "assistant", content: reply }]); setInput(""); setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 60); },
    onError: (e) => { reportError("Strategist", e instanceof StrategistAuthError ? e.message : e); qc.invalidateQueries({ queryKey: ["strategist-config"] }); },
  });

  if (!isEngineConfigured) return <EmptyState title="Sign in to open the strategist" hint="Grounded in your real data only — never faked." />;

  const s = snap.data;
  const busy = send.isPending;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Objective + Context */}
      <div className="row2">
        <DeckTile>
          <TileHead name="Your objective" right="steers every answer" />
          <textarea className="input" style={{ minHeight: 70, resize: "vertical", width: "100%" }} placeholder="e.g. grow monthly profit 20% without adding cash risk; or prep for Ramadan"
            value={obj} onChange={(e) => setObjective(e.target.value)} onBlur={() => saveObjective(obj)} />
        </DeckTile>
        <DeckTile>
          <TileHead name="Situational context" right="real-world facts you know" />
          <textarea className="input" style={{ minHeight: 70, resize: "vertical", width: "100%" }} placeholder="e.g. cashew supplier raised prices 12%; considering a second stand; running a weekend promo"
            value={ctx} onChange={(e) => setContext(e.target.value)} onBlur={() => saveContext(ctx)} />
        </DeckTile>
      </div>

      {/* Strategist briefing + chat */}
      <DeckTile>
        <TileHead name="AI strategist" right={s ? `${calendar.dayOfWeek}, ${calendar.today}` : "loading data…"} />
        {snap.isLoading && <SkeletonRows rows={3} />}
        {snap.isError && <ErrorState message={String((snap.error as Error)?.message)} onRetry={() => snap.refetch()} />}
        {s && (
          <>
            <div ref={scrollRef} className="scroll" style={{ maxHeight: 460, display: "grid", gap: 14, paddingRight: 4 }}>
              {messages.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.55 }}>
                  Set your objective above, then generate today's briefing. Every figure about Bosta Bites comes strictly from your live data; strategy comes from real retail/snack/nut expertise + the calendar.
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{ justifySelf: m.role === "user" ? "end" : "start", maxWidth: m.role === "user" ? "80%" : "100%", width: m.role === "assistant" ? "100%" : undefined }}>
                  {m.role === "user"
                    ? <div style={{ background: "var(--mag)", color: "#fff", padding: "8px 12px", borderRadius: 14, fontSize: 13.5, fontWeight: 500 }}>{m.content}</div>
                    : <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", background: "var(--panel2)" }}><Markdown text={m.content} /></div>}
                </div>
              ))}
              {busy && <div style={{ fontSize: 12.5, color: "var(--dim)" }}>Thinking through your numbers…</div>}
            </div>

            {messages.length === 0 ? (
              <Button className="mt-3" onClick={() => send.mutate(BRIEF_PROMPT)} disabled={busy}>{busy ? "Analysing…" : "Generate today's briefing"}</Button>
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK.map((qp) => <button key={qp} className="chip" onClick={() => send.mutate(qp)} disabled={busy} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 999, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>{qp}</button>)}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="input" style={{ flex: 1 }} placeholder="Ask a follow-up…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && input.trim() && !busy) send.mutate(input.trim()); }} />
                  <Button onClick={() => input.trim() && send.mutate(input.trim())} disabled={busy || !input.trim()}>Send</Button>
                </div>
              </div>
            )}
          </>
        )}
      </DeckTile>

      {/* Calendar strip */}
      {s && calendar.upcoming.length > 0 && (
        <DeckTile>
          <TileHead name="Retail calendar ahead" right="fixed dates — plan around them" />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {calendar.upcoming.map((e) => (
              <div key={e.name + e.date} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "8px 12px", minWidth: 150 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{e.name}{e.approx ? " *" : ""}</div>
                <div style={{ fontSize: 11.5, color: "var(--mag)", fontWeight: 700 }}>in {e.daysUntil} days</div>
                <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 3, lineHeight: 1.4 }}>{e.why}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 8 }}>* Islamic dates are moon-sighting approximations.</div>
        </DeckTile>
      )}

      {/* Trends + Data confidence */}
      {s && (
        <div className="row2">
          <DeckTile>
            <TileHead name="Trends" right="from your data" />
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <div className="eyebrow" style={{ color: "var(--dim)", marginBottom: 6 }}>Monthly revenue</div>
                <Sparkline data={s.series.monthlyRevenue.map((m) => m.revenue ?? 0)} height={54} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--dim)", marginTop: 4 }}>
                  <span>MoM {s.revenue.momGrowthPct == null ? "—" : `${s.revenue.momGrowthPct > 0 ? "+" : ""}${s.revenue.momGrowthPct}%`}</span>
                  <span>forecast next 30d: {s.forecast.next30 == null ? "—" : egp(s.forecast.next30)} ({s.forecast.confidence})</span>
                </div>
              </div>
              <TrendRow label="Trajectory · last 3mo vs prior 3" value={s.trends.trajectory} />
              <TrendRow label="Year-over-year · latest month" value={s.trends.yoyLatestPct == null ? "—" : `${s.trends.yoyLatestPct > 0 ? "+" : ""}${s.trends.yoyLatestPct}%`} />
              <TrendRow label="Best weekday" value={bestDay(s.series.dayOfWeek)} />
              <TrendRow label="Awaiting cheque (open tab)" value={s.settlement.openTabRevenue == null ? "—" : `${egp(s.settlement.openTabRevenue)} · ${s.settlement.openTabDays ?? 0}d`} />
              <TrendRow label="Blended mall deduction" value={s.settlement.blendedDeductionPct == null ? "—" : `${s.settlement.blendedDeductionPct}%`} />
              <div>
                <div className="eyebrow" style={{ color: "var(--dim)", margin: "4px 0 6px" }}>Top margin movers <span style={{ color: "var(--faint)", textTransform: "none", fontWeight: 500 }}>· partial detail days</span></div>
                {s.products.topByMargin.slice(0, 4).map((p) => <ProdRow key={p.name} p={p} good />)}
                {s.products.bottomByMargin.slice(0, 3).map((p) => <ProdRow key={p.name} p={p} />)}
              </div>
            </div>
          </DeckTile>

          <DeckTile>
            <TileHead name="Data confidence" right="what's solid vs thin" />
            <div style={{ display: "grid", gap: 6 }}>
              <TrendRow label="Business health" value={`${s.heuristics.health.overall ?? "—"}/100 · ${s.heuristics.health.status}`} />
              <TrendRow label="This-month profit" value={s.profit.complete ? `${egp(s.profit.thisMonthNet ?? 0)} (complete)` : `withheld · ${s.profit.missingCostLines} lines lack cost`} />
              <TrendRow label="Days traded" value={num(s.coverage.daysTraded)} />
              <div style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.45, margin: "2px 0 6px" }}>{s.coverage.productDetail}</div>
              <div className="eyebrow" style={{ color: "var(--dim)", margin: "4px 0 4px" }}>Open data gaps</div>
              {s.heuristics.dataGaps.length === 0 && <div style={{ fontSize: 12.5, color: "var(--green)" }}>None — books are clean.</div>}
              {s.heuristics.dataGaps.map((g) => (
                <div key={g.title} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                  <span style={{ color: g.severity === "high" ? "var(--red)" : g.severity === "medium" ? "var(--amber)" : "var(--muted)" }}>{g.title}</span>
                  <span style={{ color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>{g.count}</span>
                </div>
              ))}
            </div>
          </DeckTile>
        </div>
      )}
    </div>
  );
}

function TrendRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12.5 }}><span style={{ color: "var(--muted)" }}>{label}</span><span style={{ color: "var(--text)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span></div>;
}
function ProdRow({ p, good }: { p: { name: string; marginPct: number | null; costSource: string }; good?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12.5, padding: "2px 0" }}>
      <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }} dir="rtl">{p.name}</span>
      <span style={{ color: good ? "var(--green)" : "var(--amber)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{p.marginPct == null ? "—" : `${p.marginPct}%`}{p.costSource === "estimate" ? "*" : ""}</span>
    </div>
  );
}
function bestDay(dow: { day: string; avg: number | null }[]): string {
  const best = [...dow].filter((d) => d.avg != null).sort((a, b) => (b.avg! - a.avg!))[0];
  return best ? `${best.day} · ${egp(best.avg!)}` : "—";
}
