/** Business Strategist — the rebuilt Insights › Health screen. A proactive HEALTH
 *  DASHBOARD (not a chat, not a form): it leads with live KPIs + an auto-generated
 *  daily strategy built from everything the app knows, reasoning ON TOP of the
 *  heuristic engines. Objective/context are optional tuning, tucked away. TRENDS
 *  and DATA-CONFIDENCE are rendered deterministically from the snapshot. The
 *  briefing is cached per day. The ONLY writes are objective/context + the cached
 *  briefing (rule 9). */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DeckTile, TileHead, Stat } from "./deck";
import { Button, Sparkline } from "@/components/ui";
import { SkeletonRows, ErrorState, EmptyState } from "@/components/feedback";
import { isEngineConfigured } from "@/core/db/engine";
import { todayCairo } from "@/core/time";
import { egp, egpShort, num } from "@/core/utils/format";
import { useUI } from "@/store/ui";
import { assembleSnapshot } from "@/core/strategist/snapshot";
import { computeCalendar, type CalendarContext } from "@/core/strategist/calendar";
import { askStrategist, StrategistAuthError } from "@/core/strategist/client";
import { getStrategistConfig, saveObjective, saveContext, getStrategistBriefing, saveStrategistBriefing, type StrategistBriefing } from "@/core/strategist/config";

const dailyPrompt = (cal: CalendarContext) => `It's ${cal.dayOfWeek}, ${cal.today}. Give me my strategy dashboard for today — no preamble, no sign-off.

**Today's focus** — one sharp line: the single most important thing to do today.

**Today's tips** — 3 to 5 concrete, prioritized moves for today and this week. Tie each to what day it is (weekend vs weekday), my live data, the retail calendar, and my objective. Be specific — by product, weight, and timing.

**What the data says** — 2 to 3 grounded insights from my revenue trend, seasonality, year-over-year, weekday pattern, margins or cash.

**Watch** — 1 to 2 risks or things to keep an eye on.

Ground every Bosta figure strictly in my data; use real snack/nut/candy retail expertise and known patterns; invent no external numbers.`;

/** Tiny, dependency-free markdown → JSX (headers, bold, bullets, paragraphs). */
function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let list: string[] = [];
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, k) => (p.startsWith("**") && p.endsWith("**")) ? <b key={k} style={{ color: "var(--text)", fontWeight: 700 }}>{p.slice(2, -2)}</b> : <span key={k}>{p}</span>);
  const flush = (i: number) => { if (!list.length) return; blocks.push(<ul key={`u${i}`} style={{ margin: "6px 0 12px", paddingLeft: 18, display: "grid", gap: 6 }}>{list.map((l, j) => <li key={j} style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--muted)" }}>{inline(l)}</li>)}</ul>); list = []; };
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (/^#{1,3}\s/.test(l)) { flush(i); blocks.push(<div key={i} style={{ fontWeight: 700, color: "var(--text)", fontSize: 15, margin: "14px 0 4px" }}>{inline(l.replace(/^#{1,3}\s/, ""))}</div>); }
    else if (/^\*\*[^*]+\*\*$/.test(l)) { flush(i); blocks.push(<div key={i} style={{ fontWeight: 800, color: "var(--mag)", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", margin: "16px 0 6px" }}>{l.slice(2, -2)}</div>); }
    else if (/^[-*]\s/.test(l)) { list.push(l.replace(/^[-*]\s/, "")); }
    else if (!l) { flush(i); }
    else { flush(i); blocks.push(<p key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)", margin: "0 0 8px" }}>{inline(l)}</p>); }
  });
  flush(lines.length);
  return <div>{blocks}</div>;
}

export function StrategistScreen() {
  const { reportError } = useUI();
  const today = todayCairo();
  const calendar = useMemo(() => computeCalendar(today), [today]);

  const cfg = useQuery({ queryKey: ["strategist-config"], queryFn: getStrategistConfig, enabled: isEngineConfigured });
  const snap = useQuery({ queryKey: ["strategist-snapshot"], queryFn: assembleSnapshot, enabled: isEngineConfigured, staleTime: 5 * 60_000 });
  const cache = useQuery({ queryKey: ["strategist-briefing"], queryFn: getStrategistBriefing, enabled: isEngineConfigured });

  const [objective, setObjective] = useState<string | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [tune, setTune] = useState(false);
  const obj = objective ?? cfg.data?.objective ?? "";
  const ctx = context ?? cfg.data?.context ?? "";

  const [fresh, setFresh] = useState<StrategistBriefing | null>(null);
  const cachedToday = cache.data && cache.data.date === today ? cache.data : null;
  const briefing = fresh ?? cachedToday;

  const gen = useMutation({
    mutationFn: async (): Promise<StrategistBriefing> => {
      if (!snap.data) throw new Error("Snapshot not ready yet.");
      await Promise.all([saveObjective(obj), saveContext(ctx)]);
      const reply = await askStrategist({ objective: obj, context: ctx, snapshot: snap.data, calendar, messages: [{ role: "user", content: dailyPrompt(calendar) }] });
      const b: StrategistBriefing = { date: today, reply, generatedAt: new Date().toISOString() };
      await saveStrategistBriefing(b);
      return b;
    },
    onSuccess: (b) => setFresh(b),
    onError: (e) => reportError("Strategist", e instanceof StrategistAuthError ? e.message : e),
  });

  // Auto-generate today's briefing once, only if there isn't already one for today.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!isEngineConfigured || autoRan.current) return;
    if (snap.data && cache.isFetched && !cachedToday && !gen.isPending) { autoRan.current = true; gen.mutate(); }
  }, [snap.data, cache.isFetched, cachedToday, gen.isPending]); // eslint-disable-line

  if (!isEngineConfigured) return <EmptyState title="Sign in to open the strategist" hint="Grounded in your real data only — never faked." />;

  const s = snap.data;
  const busy = gen.isPending;
  const monthly = s?.series.monthlyRevenue ?? [];
  const latest = monthly.length ? monthly[monthly.length - 1] : null;
  const overall = s?.heuristics.health.overall ?? null;
  const hcol = overall == null ? "var(--faint)" : overall >= 75 ? "var(--green)" : overall >= 55 ? "var(--amber)" : "var(--red)";
  const pctLabel = (p: number | null | undefined) => (p == null ? "—" : `${p > 0 ? "+" : ""}${p}%`);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* KPI hero — instant, deterministic, always populated */}
      {snap.isLoading && <SkeletonRows rows={2} />}
      {snap.isError && <ErrorState message={String((snap.error as Error)?.message)} onRetry={() => snap.refetch()} />}
      {s && (
        <div className="statgrid">
          <Stat label="Business health" color={hcol} value={overall == null ? "—" : `${overall}`} sub={<span style={{ color: hcol, fontSize: 11, fontWeight: 700 }}>{s.heuristics.health.status}</span>} />
          <Stat label="Revenue · all-time" color="var(--violet)" value={s.revenue.allTime == null ? "—" : egpShort(s.revenue.allTime)} sub={`${num(s.coverage.daysTraded)} days traded`} />
          <Stat label={`Latest month${latest ? ` · ${latest.month}` : ""}`} color="var(--mag)" value={latest?.revenue == null ? "—" : egp(latest.revenue)} sub={`MoM ${pctLabel(s.trends.momPct)} · YoY ${pctLabel(s.trends.yoyLatestPct)}`} />
          <Stat label="Cheque income" color="var(--cyan)" value={s.settlement.totalReceived == null ? "—" : egpShort(s.settlement.totalReceived)} sub={`mall takes ${s.settlement.blendedDeductionPct ?? "—"}%`} />
        </div>
      )}

      {/* Today's strategy — the hero AI briefing */}
      <DeckTile>
        <TileHead
          name={`Today's strategy · ${calendar.dayOfWeek}${calendar.isWeekend ? " (weekend)" : ""}`}
          right={
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setTune((t) => !t)} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--line)", background: tune ? "var(--panel2)" : "transparent", color: "var(--muted)", cursor: "pointer" }}>⚙ Tune</button>
              {s && <Button size="sm" variant="outline" onClick={() => gen.mutate()} disabled={busy}>{busy ? "Thinking…" : briefing ? "Refresh" : "Generate"}</Button>}
            </div>
          }
        />
        {tune && (
          <div style={{ display: "grid", gap: 10, marginBottom: 14, padding: 12, border: "1px dashed var(--line)", borderRadius: 12 }}>
            <div>
              <div className="eyebrow" style={{ color: "var(--dim)", marginBottom: 4 }}>Your objective — steers the strategy (optional)</div>
              <textarea className="input" style={{ minHeight: 48, resize: "vertical", width: "100%" }} placeholder="e.g. grow monthly profit 20% without adding cash risk; prep for Ramadan" value={obj} onChange={(e) => setObjective(e.target.value)} onBlur={() => saveObjective(obj)} />
            </div>
            <div>
              <div className="eyebrow" style={{ color: "var(--dim)", marginBottom: 4 }}>Situational context — real-world facts only you know (optional)</div>
              <textarea className="input" style={{ minHeight: 48, resize: "vertical", width: "100%" }} placeholder="e.g. cashew supplier raised prices 12%; running a weekend promo" value={ctx} onChange={(e) => setContext(e.target.value)} onBlur={() => saveContext(ctx)} />
            </div>
            <div style={{ fontSize: 11, color: "var(--faint)" }}>Tap Refresh after editing to fold these into today's strategy.</div>
          </div>
        )}
        {s && !briefing && busy && <div style={{ fontSize: 13, color: "var(--dim)", padding: "8px 0" }}>Reading your numbers, trends and the calendar to build today's strategy…</div>}
        {s && !briefing && !busy && <div style={{ fontSize: 13, color: "var(--dim)", padding: "8px 0" }}>No strategy yet — tap Generate.</div>}
        {briefing && (
          <>
            <Markdown text={briefing.reply} />
            <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 6 }}>Generated {briefing.generatedAt.slice(0, 16).replace("T", " ")} · grounded in your live data{latest ? ` · freshest data ${latest.month}` : ""}.</div>
          </>
        )}
      </DeckTile>

      {/* Calendar strip */}
      {s && calendar.upcoming.length > 0 && (
        <DeckTile>
          <TileHead name="Retail calendar ahead" right="plan around these" />
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
            <TileHead name="Trends" right="full history" />
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <div className="eyebrow" style={{ color: "var(--dim)", marginBottom: 6 }}>Monthly revenue</div>
                <Sparkline data={monthly.map((m) => m.revenue ?? 0)} height={54} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--dim)", marginTop: 4 }}>
                  <span>{s.trends.monthsOfData} months · {s.trends.trajectory}</span>
                  <span>YoY {pctLabel(s.trends.yoyLatestPct)}</span>
                </div>
              </div>
              <TrendRow label="Best month" value={s.trends.best ? `${s.trends.best.month} · ${egp(s.trends.best.revenue)}` : "—"} />
              <TrendRow label="Best weekday" value={bestDay(s.series.dayOfWeek)} />
              <TrendRow label="Awaiting cheque (open tab)" value={s.settlement.openTabRevenue == null ? "—" : `${egp(s.settlement.openTabRevenue)} · ${s.settlement.openTabDays ?? 0}d`} />
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
              <TrendRow label="Business health" value={`${overall ?? "—"}/100 · ${s.heuristics.health.status}`} />
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
